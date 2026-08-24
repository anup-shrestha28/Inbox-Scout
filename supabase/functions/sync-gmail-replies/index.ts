import { adminClient, corsHeaders, decryptRefreshToken, gmailAccessToken, json, verifyCron } from "../_shared/common.ts";

interface ReplyJob {
  id: string;
  user_id: string;
  lead_id: string;
  sent_at: string;
  google_thread_id: string;
}

function headerValue(message: Record<string, unknown>, name: string): string {
  const payload = message.payload as { headers?: Array<{ name: string; value: string }> } | undefined;
  return payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!verifyCron(request)) return json({ error: "Unauthorized." }, 401);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("id,user_id,lead_id,sent_at,google_thread_id")
    .eq("status", "sent")
    .not("google_thread_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  const jobs = (data ?? []) as ReplyJob[];
  const accessTokens = new Map<string, { token: string; email: string }>();
  let replies = 0;

  for (const job of jobs) {
    try {
      let connection = accessTokens.get(job.user_id);
      if (!connection) {
        const { data: gmail, error: gmailError } = await supabase
          .from("gmail_connections")
          .select("connected_email,refresh_token_ciphertext,token_iv")
          .eq("user_id", job.user_id)
          .single();
        if (gmailError || !gmail) continue;
        const refreshToken = await decryptRefreshToken(
          gmail.refresh_token_ciphertext,
          gmail.token_iv,
        );
        connection = {
          token: await gmailAccessToken(refreshToken),
          email: gmail.connected_email.toLowerCase(),
        };
        accessTokens.set(job.user_id, connection);
      }

      const endpoint = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(job.google_thread_id)}`,
      );
      endpoint.searchParams.set("format", "metadata");
      endpoint.searchParams.append("metadataHeaders", "From");
      endpoint.searchParams.append("metadataHeaders", "Date");
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${connection.token}` },
      });
      if (!response.ok) continue;
      const thread = (await response.json()) as { messages?: Array<Record<string, unknown>> };
      const sentAt = new Date(job.sent_at).getTime();
      const reply = thread.messages?.find((message) => {
        const from = headerValue(message, "From").toLowerCase();
        const internalDate = Number(message.internalDate ?? 0);
        return from && !from.includes(connection!.email) && internalDate > sentAt;
      });
      if (!reply) continue;

      const repliedAt = new Date(Number(reply.internalDate)).toISOString();
      await supabase
        .from("campaign_leads")
        .update({ status: "replied", replied_at: repliedAt })
        .eq("id", job.id)
        .eq("status", "sent");
      await supabase.from("leads").update({ status: "replied" }).eq("id", job.lead_id);
      await supabase.from("email_events").insert({
        user_id: job.user_id,
        campaign_lead_id: job.id,
        event_type: "replied",
        detail: `Reply detected from ${headerValue(reply, "From").slice(0, 180)}.`,
      });
      replies += 1;
    } catch {
      // A single inaccessible Gmail thread should not stop the remaining sync.
    }
  }

  return json({ checked: jobs.length, replies });
});
