import { createClient } from "@/lib/supabase/server";
import { mapCampaign } from "@/lib/repositories/mappers";
import type { Campaign, CampaignInput } from "@/lib/types";

export async function getCampaigns(userId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, campaign_leads(status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapCampaign(row as unknown as Record<string, unknown>));
}

export async function createCampaign(
  userId: string,
  input: CampaignInput,
): Promise<Campaign> {
  if (input.cvPath && !input.cvPath.startsWith(`${userId}/`)) {
    throw new Error("The selected CV does not belong to this workspace.");
  }
  const supabase = await createClient();
  const { data: leads, error: leadError } = await supabase
    .from("leads")
    .select("id,email,status")
    .eq("user_id", userId)
    .in("id", input.leadIds)
    .eq("status", "approved")
    .not("email", "is", null);
  if (leadError) throw new Error(leadError.message);
  if (!leads?.length) throw new Error("Approve at least one lead with a published email first.");

  const emails = leads.map((lead) => lead.email).filter(Boolean) as string[];
  const { data: blocked, error: blockedError } = await supabase
    .from("suppression_list")
    .select("email")
    .eq("user_id", userId)
    .in("email", emails);
  if (blockedError) throw new Error(blockedError.message);
  const blockedEmails = new Set((blocked ?? []).map((row) => String(row.email).toLowerCase()));
  const eligible = leads.filter((lead) => !blockedEmails.has(String(lead.email).toLowerCase()));
  if (!eligible.length) throw new Error("All selected contacts are on the do-not-contact list.");

  const scheduledFor = input.scheduledAt ?? new Date().toISOString();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      user_id: userId,
      name: input.name,
      subject_template: input.subjectTemplate,
      body_template: input.bodyTemplate,
      cv_path: input.cvPath,
      daily_limit: input.dailyLimit,
      send_timezone: input.sendTimezone,
      send_start: input.sendStart,
      send_end: input.sendEnd,
      scheduled_at: scheduledFor,
      status: "scheduled",
    })
    .select("*")
    .single();
  if (campaignError) throw new Error(campaignError.message);

  const jobs = eligible.map((lead) => ({
    user_id: userId,
    campaign_id: campaign.id,
    lead_id: lead.id,
    status: "queued" as const,
    scheduled_for: scheduledFor,
  }));
  const { data: insertedJobs, error: jobError } = await supabase
    .from("campaign_leads")
    .insert(jobs)
    .select("id");
  if (jobError) {
    await supabase.from("campaigns").delete().eq("id", campaign.id).eq("user_id", userId);
    throw new Error(jobError.message);
  }

  if (insertedJobs?.length) {
    await supabase.from("email_events").insert(
      insertedJobs.map((job) => ({
        user_id: userId,
        campaign_lead_id: job.id,
        event_type: "queued",
        detail: "Campaign approved and queued by the user.",
      })),
    );
  }

  return mapCampaign({ ...campaign, campaign_leads: jobs });
}

export async function setCampaignStatus(
  userId: string,
  campaignId: string,
  status: "scheduled" | "paused",
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
