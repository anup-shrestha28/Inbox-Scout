import type { Campaign, Lead } from "@/lib/types";

export function mapLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    kind: row.kind as Lead["kind"],
    name: String(row.name ?? ""),
    company: String(row.company ?? ""),
    role: String(row.role ?? ""),
    email: row.email ? String(row.email) : null,
    location: String(row.location ?? ""),
    country: String(row.country ?? ""),
    websiteUrl: row.website_url ? String(row.website_url) : null,
    linkedinUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    instagramUrl: row.instagram_url ? String(row.instagram_url) : null,
    facebookUrl: row.facebook_url ? String(row.facebook_url) : null,
    sourceUrl: String(row.source_url ?? ""),
    sourceType: row.source_type as Lead["sourceType"],
    confidence: Number(row.confidence ?? 0),
    status: row.status as Lead["status"],
    emailPublic: Boolean(row.email_public),
    evidence: row.evidence ? String(row.evidence) : null,
    createdAt: String(row.created_at),
  };
}

export function mapCampaign(row: Record<string, unknown>): Campaign {
  const jobs = (row.campaign_leads as Array<Record<string, unknown>> | undefined) ?? [];
  const count = (status: string) => jobs.filter((job) => job.status === status).length;

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    subjectTemplate: String(row.subject_template ?? ""),
    bodyTemplate: String(row.body_template ?? ""),
    cvPath: row.cv_path ? String(row.cv_path) : null,
    dailyLimit: Number(row.daily_limit ?? 15),
    sendTimezone: String(row.send_timezone ?? "Asia/Kathmandu"),
    sendStart: String(row.send_start ?? "09:00").slice(0, 5),
    sendEnd: String(row.send_end ?? "17:00").slice(0, 5),
    status: row.status as Campaign["status"],
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    total: jobs.length,
    queued: count("queued") + count("sending"),
    sent: count("sent") + count("replied"),
    replied: count("replied"),
    failed: count("failed"),
    createdAt: String(row.created_at),
  };
}

