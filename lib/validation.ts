import { z } from "zod";

import { REGION_MODES, SOURCE_TYPES } from "@/lib/types";

const cleanText = z.string().trim();

export const searchInputSchema = z.object({
  query: cleanText.max(160).default(""),
  roles: z.array(cleanText.min(2).max(80)).min(1).max(8),
  regionMode: z.enum(REGION_MODES),
  countries: z.array(cleanText.min(2).max(80)).max(12).default([]),
  cities: z.array(cleanText.min(2).max(80)).max(12).default([]),
  sources: z.array(z.enum(SOURCE_TYPES)).min(1),
  leadType: z.enum(["all", "agency", "person"]).default("all"),
  deepScan: z.boolean().default(true),
});

export const campaignInputSchema = z.object({
  name: cleanText.min(2).max(100),
  subjectTemplate: cleanText.min(2).max(180),
  bodyTemplate: cleanText.min(20).max(10_000),
  leadIds: z.array(z.string().uuid()).min(1).max(250),
  cvPath: z.string().max(500).nullable().default(null),
  dailyLimit: z.number().int().min(1).max(50).default(15),
  sendTimezone: cleanText.min(3).max(80).default("Asia/Kathmandu"),
  sendStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  sendEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("17:00"),
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export const leadStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(250),
  status: z.enum(["new", "approved", "rejected"]),
});

export function validationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

