export const SOURCE_TYPES = ["web", "linkedin", "instagram", "facebook"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const REGION_MODES = ["nepal", "international", "both"] as const;
export type RegionMode = (typeof REGION_MODES)[number];

export const LEAD_STATUSES = [
  "new",
  "approved",
  "rejected",
  "contacted",
  "replied",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadKind = "agency" | "person";

export interface LeadSource {
  id?: string;
  type: SourceType;
  url: string;
  evidence?: string | null;
}

export interface Lead {
  id: string;
  kind: LeadKind;
  name: string;
  company: string;
  role: string;
  email: string | null;
  location: string;
  country: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  sourceUrl: string;
  sourceType: SourceType;
  confidence: number;
  status: LeadStatus;
  emailPublic: boolean;
  evidence: string | null;
  createdAt: string;
}

export interface SearchInput {
  query: string;
  roles: string[];
  regionMode: RegionMode;
  countries: string[];
  cities: string[];
  sources: SourceType[];
  leadType: "all" | LeadKind;
  deepScan: boolean;
}

export type CampaignStatus = "draft" | "scheduled" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  cvPath: string | null;
  dailyLimit: number;
  sendTimezone: string;
  sendStart: string;
  sendEnd: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  total: number;
  queued: number;
  sent: number;
  replied: number;
  failed: number;
  createdAt: string;
}

export interface CampaignInput {
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  leadIds: string[];
  cvPath: string | null;
  dailyLimit: number;
  sendTimezone: string;
  sendStart: string;
  sendEnd: string;
  scheduledAt: string | null;
}

export interface AppBootstrap {
  demoMode: boolean;
  searchConfigured: boolean;
  gmailConfigured: boolean;
  gmailConnected: boolean;
  connectedEmail: string | null;
  leads: Lead[];
  campaigns: Campaign[];
}

export interface PublicContact {
  name: string | null;
  company: string;
  role: string | null;
  email: string;
  sourceUrl: string;
  evidence: string | null;
  confidence: number;
}

