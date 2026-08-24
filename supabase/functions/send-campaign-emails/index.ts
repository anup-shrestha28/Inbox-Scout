import { adminClient, corsHeaders, decryptRefreshToken, gmailAccessToken, json, verifyCron } from "../_shared/common.ts";
import { buildMimeMessage, sendGmailMessage } from "../_shared/gmail.ts";
import { renderTemplate } from "../_shared/template.ts";

interface JobRecord {
  id: string;
  user_id: string;
  status: string;
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

function insideSendWindow(campaign: JobRecord["campaigns"]): boolean {
  try {
    const now = minutesInZone(campaign.send_timezone);
    const start = toMinutes(campaign.send_start);
    const end = toMinutes(campaign.send_end);
    return start <= end ? now >= start && now <= end : now >= start || now <= end;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!verifyCron(request)) return json({ error: "Unauthorized." }, 401);

  const supabase = adminClient();
  await supabase
    .from("campaign_leads")
    .update({ status: "queued", locked_at: null, last_error: "Recovered after an interrupted send." })
    .eq("status", "sending")
    .lt("locked_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*, campaigns!inner(*), leads!inner(id,name,company,role,location,email)")
    .eq("status", "queued")
    .eq("campaigns.status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(2);
  if (error) return json({ error: error.message }, 500);

  const jobs = (data ?? []) as unknown as JobRecord[];
  const accessTokens = new Map<string, { token: string; email: string }>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    if (!insideSendWindow(job.campaigns)) continue;

    const { data: lock } = await supabase
      .from("campaign_leads")
      .update({ status: "sending", locked_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!lock) continue;

    try {
      if (!job.leads.email) throw new Error("Lead does not have a published email.");

      const rollingDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", job.user_id)
        .in("status", ["sent", "replied"])
        .gte("sent_at", rollingDay);
      if ((count ?? 0) >= job.campaigns.daily_limit) {
        await supabase
          .from("campaign_leads")
          .update({ status: "queued", locked_at: null })
          .eq("id", job.id);
        continue;
      }

      const { data: suppression } = await supabase
        .from("suppression_list")
        .select("id")
        .eq("user_id", job.user_id)
        .eq("email", job.leads.email)
        .maybeSingle();
      if (suppression) {
        await supabase
          .from("campaign_leads")
          .update({ status: "skipped", last_error: "Contact is on the suppression list." })
          .eq("id", job.id);
        skipped += 1;
        continue;
      }

      let connection = accessTokens.get(job.user_id);
      if (!connection) {
        const { data: gmail, error: gmailError } = await supabase
          .from("gmail_connections")
          .select("connected_email,refresh_token_ciphertext,token_iv")
          .eq("user_id", job.user_id)
          .single();
        if (gmailError || !gmail) throw new Error("Gmail is not connected.");
        const refreshToken = await decryptRefreshToken(
          gmail.refresh_token_ciphertext,
          gmail.token_iv,
        );
        connection = {
          token: await gmailAccessToken(refreshToken),
          email: gmail.connected_email,
        };
        accessTokens.set(job.user_id, connection);
      }

      let attachment: { bytes: Uint8Array; filename: string } | null = null;
      if (job.campaigns.cv_path) {
        const { data: file, error: fileError } = await supabase.storage
          .from("cvs")
          .download(job.campaigns.cv_path);
        if (fileError || !file) throw new Error("The campaign CV could not be loaded.");
        attachment = {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: job.campaigns.cv_path.split("/").pop()?.replace(/^\d+-/, "") ?? "CV.pdf",
        };
      }

      const values = {
        name: job.leads.name,
        company: job.leads.company,
        role: job.leads.role,
        location: job.leads.location,
      };
      const raw = buildMimeMessage({
        to: job.leads.email,
        from: connection.email,
        subject: renderTemplate(job.campaigns.subject_template, values),
        body: renderTemplate(job.campaigns.body_template, values),
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
      await supabase.from("leads").update({ status: "contacted" }).eq("id", job.leads.id);
      await supabase.from("email_events").insert({
        user_id: job.user_id,
        campaign_lead_id: job.id,
        event_type: "sent",
        detail: `Sent through ${connection.email}.`,
      });
      sent += 1;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message.slice(0, 500) : "Unknown send error";
      const attempts = job.attempt_count + 1;
      const retryable =
        attempts < 3 && /429|rate|temporar|timeout|timed out|network|fetch|50[0-9]|service unavailable/i.test(message);
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
      if (!retryable) failed += 1;
    }
  }

  return json({ processed: jobs.length, sent, failed, skipped });
});
