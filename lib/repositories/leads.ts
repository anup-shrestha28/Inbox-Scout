import { createClient } from "@/lib/supabase/server";
import type { Lead, LeadStatus } from "@/lib/types";
import { mapLead } from "@/lib/repositories/mappers";

function storageKey(lead: Pick<Lead, "email" | "websiteUrl" | "company">): string {
  if (lead.email) return `email:${lead.email.toLowerCase()}`;
  if (lead.websiteUrl) {
    try {
      return `host:${new URL(lead.websiteUrl).hostname.replace(/^www\./, "")}`;
    } catch {
      // Continue with company matching.
    }
  }
  return `company:${lead.company.toLowerCase().replace(/\W+/g, "")}`;
}

export async function getLeads(userId: string): Promise<Lead[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapLead(row as Record<string, unknown>));
}

export async function saveDiscoveredLeads(
  userId: string,
  searchId: string,
  discovered: Lead[],
): Promise<Lead[]> {
  const supabase = await createClient();
  const existing = await getLeads(userId);
  const byKey = new Map(existing.map((lead) => [storageKey(lead), lead]));

  for (const lead of discovered) {
    const previous = byKey.get(storageKey(lead));
    let leadId = previous?.id;

    if (previous) {
      const { error } = await supabase
        .from("leads")
        .update({
          search_id: searchId,
          name: lead.confidence >= previous.confidence ? lead.name : previous.name,
          company: lead.company || previous.company,
          role: lead.role || previous.role,
          email: previous.email ?? lead.email,
          location: lead.location || previous.location,
          country: lead.country || previous.country,
          website_url: previous.websiteUrl ?? lead.websiteUrl,
          linkedin_url: previous.linkedinUrl ?? lead.linkedinUrl,
          instagram_url: previous.instagramUrl ?? lead.instagramUrl,
          facebook_url: previous.facebookUrl ?? lead.facebookUrl,
          confidence: Math.max(previous.confidence, lead.confidence),
          email_public: previous.emailPublic || lead.emailPublic,
          evidence: lead.confidence >= previous.confidence ? lead.evidence : previous.evidence,
        })
        .eq("id", previous.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert({
          id: lead.id,
          user_id: userId,
          search_id: searchId,
          kind: lead.kind,
          name: lead.name,
          company: lead.company,
          role: lead.role,
          email: lead.email,
          location: lead.location,
          country: lead.country,
          website_url: lead.websiteUrl,
          linkedin_url: lead.linkedinUrl,
          instagram_url: lead.instagramUrl,
          facebook_url: lead.facebookUrl,
          source_url: lead.sourceUrl,
          source_type: lead.sourceType,
          confidence: lead.confidence,
          status: lead.status,
          email_public: lead.emailPublic,
          evidence: lead.evidence,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      leadId = data.id;
      byKey.set(storageKey(lead), lead);
    }

    if (leadId) {
      const { error } = await supabase.from("lead_sources").upsert(
        {
          user_id: userId,
          lead_id: leadId,
          source_type: lead.sourceType,
          source_url: lead.sourceUrl,
          evidence: lead.evidence,
        },
        { onConflict: "lead_id,source_url", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    }
  }

  return getLeads(userId);
}

export async function updateLeadStatuses(
  userId: string,
  ids: string[],
  status: Extract<LeadStatus, "new" | "approved" | "rejected">,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ status })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
}

