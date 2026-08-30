/**
 * Local sending worker.
 *
 * This is the laptop twin of supabase/functions/send-campaign-emails. It applies
 * the same guardrails — scheduled campaigns only, send window, rolling daily
 * limit, suppression list, single-send locking, and capped retries — so the two
 * can be run interchangeably without double-sending.
 *
 *   npm run send:preview   shows what would go out and changes nothing
 *   npm run send           actually sends
 */
import { requiredEnv } from "@/lib/config";
import { buildMimeMessage } from "@/lib/email/mime";
import { decryptToken } from "@/lib/email/token-crypto";
import { isPdfBytes } from "@/lib/pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/template";

const BATCH_SIZE = 2;
const STALE_LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRYABLE =
  /429|rate|temporar|timeout|timed out|network|fetch|50[0-9]|service unavailable/i;

interface Job {
  id: string;
  user_id: string;
  attempt_count: number;
  campaigns: {
    id: string;
    name: string;
    subject_template: string;
    body_template: string;
    cv_path: string | null;
    daily_limit: number;
    send_timezone: string;
    send_start: string;
    send_end: string;
    status: string;
  };
  leads: {
    id: string;
    name: string;
    company: string;
    role: string;
    location: string;
    email: string | null;
  };
}

function minutesInZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function clockLabel(totalMinutes: number): string {
  const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minute = String(totalMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function insideSendWindow(campaign: Job["campaigns"]): boolean {
  try {
    const now = minutesInZone(campaign.send_timezone);
    const start = toMinutes(campaign.send_start);
    const end = toMinutes(campaign.send_end);
    return start <= end ? now >= start && now <= end : now >= start || now <= end;
  } catch {
    return false;
  }
}

async function gmailAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "Unable to refresh Gmail access.");
  }
  return payload.access_token;
}

async function sendGmailMessage(accessToken: string, raw: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as {
    id?: string;
    threadId?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message ?? "Gmail rejected the message.");
  }
  return payload as { id: string; threadId: string };
}

async function main(): Promise<void> {
  const live = process.argv.includes("--send");
  const supabase = createAdminClient();

  console.log(live ? "MODE: SENDING FOR REAL\n" : "MODE: preview only — nothing will be sent\n");

  if (live) {
    // Release jobs a previous interrupted run left locked.
    await supabase
      .from("campaign_leads")
      .update({
        status: "queued",
        locked_at: null,
        last_error: "Recovered after an interrupted send.",
      })
      .eq("status", "sending")
      .lt("locked_at", new Date(Date.now() - STALE_LOCK_MS).toISOString());
  }

  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*, campaigns!inner(*), leads!inner(id,name,company,role,location,email)")
    .eq("status", "queued")
    .eq("campaigns.status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("Could not read the queue:", error.message);
    process.exitCode = 1;
    return;
  }

  const jobs = (data ?? []) as unknown as Job[];
  if (!jobs.length) {
    console.log("Nothing is due right now. (Paused campaigns and future dates are ignored.)");
    return;
  }

  const tokens = new Map<string, { token: string; email: string }>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let held = 0;

  for (const job of jobs) {
    const { campaigns: campaign, leads: lead } = job;
    console.log(`\n── ${campaign.name} → ${lead.email ?? "(no email)"}`);

    // Preview keeps going past a blocker so you can still read the draft.
    const windowOpen = insideSendWindow(campaign);
    if (!windowOpen) {
      console.log(
        `   HELD: outside the send window. Allowed ${campaign.send_start.slice(0, 5)}–` +
          `${campaign.send_end.slice(0, 5)}, it is now ` +
          `${clockLabel(minutesInZone(campaign.send_timezone))} in ${campaign.send_timezone}.`,
      );
      if (live) {
        held += 1;
        continue;
      }
    }

    if (live) {
      // Claim the job atomically so a second run cannot send it again.
      const { data: lock } = await supabase
        .from("campaign_leads")
        .update({ status: "sending", locked_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!lock) {
        console.log("   HELD: another run already claimed this one.");
        held += 1;
        continue;
      }
    }

    try {
      if (!lead.email) throw new Error("Lead does not have a published email.");

      const rollingDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", job.user_id)
        .in("status", ["sent", "replied"])
        .gte("sent_at", rollingDay);
      const limitReached = (count ?? 0) >= campaign.daily_limit;
      if (limitReached) {
        console.log(
          `   HELD: daily limit reached (${count}/${campaign.daily_limit} in the last 24h).`,
        );
        if (live) {
          await supabase
            .from("campaign_leads")
            .update({ status: "queued", locked_at: null })
            .eq("id", job.id);
          held += 1;
          continue;
        }
      }

      const { data: suppression } = await supabase
        .from("suppression_list")
        .select("id")
        .eq("user_id", job.user_id)
        .eq("email", lead.email)
        .maybeSingle();
      if (suppression) {
        console.log("   SKIPPED: this address is on your do-not-contact list.");
        if (live) {
          await supabase
            .from("campaign_leads")
            .update({ status: "skipped", last_error: "Contact is on the suppression list." })
            .eq("id", job.id);
        }
        skipped += 1;
        continue;
      }

      let connection = tokens.get(job.user_id);
      if (!connection) {
        const { data: gmail, error: gmailError } = await supabase
          .from("gmail_connections")
          .select("connected_email,refresh_token_ciphertext,token_iv")
          .eq("user_id", job.user_id)
          .single();
        if (gmailError || !gmail) throw new Error("Gmail is not connected.");
        const refreshToken = decryptToken(gmail.refresh_token_ciphertext, gmail.token_iv);
        connection = {
          token: await gmailAccessToken(refreshToken),
          email: gmail.connected_email,
        };
        tokens.set(job.user_id, connection);
      }

      let attachment: { bytes: Uint8Array; filename: string } | null = null;
      if (campaign.cv_path) {
        const { data: file, error: fileError } = await supabase.storage
          .from("cvs")
          .download(campaign.cv_path);
        if (fileError || !file) throw new Error("The campaign CV could not be loaded.");
        attachment = {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: campaign.cv_path.split("/").pop()?.replace(/^\d+-/, "") ?? "CV.pdf",
        };
        // Older uploads predate the PDF content check, so verify before attaching.
        if (!isPdfBytes(attachment.bytes)) {
          throw new Error(
            `The attached CV "${attachment.filename}" is not a real PDF file, so the ` +
              "recipient would not be able to open it. Re-export it as a PDF and " +
              "create the campaign again.",
          );
        }
      }

      const values = {
        name: lead.name,
        company: lead.company,
        role: lead.role,
        location: lead.location,
      };
      const subject = renderTemplate(campaign.subject_template, values);
      const body = renderTemplate(campaign.body_template, values);

      console.log(`   From:    ${connection.email}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   CV:      ${attachment ? attachment.filename : "(none attached)"}`);
      console.log(
        body
          .split("\n")
          .map((line) => `   | ${line}`)
          .join("\n"),
      );

      if (!live) {
        if (windowOpen && !limitReached) {
          console.log("   → would send now (preview mode, nothing sent)");
          sent += 1;
        } else {
          console.log("   → held for now; this is what it will send once allowed");
          held += 1;
        }
        continue;
      }

      const raw = buildMimeMessage({
        to: lead.email,
        from: connection.email,
        subject,
        body,
        attachment,
      });
      const result = await sendGmailMessage(connection.token, raw);
      const timestamp = new Date().toISOString();

      await supabase
        .from("campaign_leads")
        .update({
          status: "sent",
          sent_at: timestamp,
          google_message_id: result.id,
          google_thread_id: result.threadId,
          attempt_count: job.attempt_count + 1,
          last_error: null,
          locked_at: null,
        })
        .eq("id", job.id);
      await supabase.from("leads").update({ status: "contacted" }).eq("id", lead.id);
      await supabase.from("email_events").insert({
        user_id: job.user_id,
        campaign_lead_id: job.id,
        event_type: "sent",
        detail: `Sent through ${connection.email} by the local worker.`,
      });

      console.log(`   ✓ SENT (Gmail id ${result.id})`);
      sent += 1;
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message.slice(0, 500) : "Unknown send error";
      console.log(`   ✗ ${message}`);

      if (!live) {
        failed += 1;
        continue;
      }

      const attempts = job.attempt_count + 1;
      const retryable = attempts < MAX_ATTEMPTS && RETRYABLE.test(message);
      await supabase
        .from("campaign_leads")
        .update({
          status: retryable ? "queued" : "failed",
          ...(retryable
            ? {
                scheduled_for: new Date(
                  Date.now() + 5 * 60 * 1000 * 2 ** (attempts - 1),
                ).toISOString(),
              }
            : {}),
          attempt_count: attempts,
          last_error: message,
          locked_at: null,
        })
        .eq("id", job.id);
      await supabase.from("email_events").insert({
        user_id: job.user_id,
        campaign_lead_id: job.id,
        event_type: "failed",
        detail: retryable ? `Retry ${attempts} scheduled: ${message}` : message,
      });
      if (retryable) {
        console.log(`   → will retry automatically (attempt ${attempts} of ${MAX_ATTEMPTS})`);
        held += 1;
      } else {
        failed += 1;
      }
    }
  }

  console.log(
    `\nDone. ${live ? "sent" : "would send"}: ${sent}   held: ${held}   ` +
      `skipped: ${skipped}   failed: ${failed}`,
  );
  if (!live) console.log("Nothing was sent. Run `npm run send` to send for real.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
