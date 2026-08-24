import { randomUUID } from "node:crypto";

import { braveWebSearch, type SearchResult } from "@/lib/discovery/brave";
import { buildDiscoveryQuery } from "@/lib/discovery/queries";
import { scanPublicWebsite } from "@/lib/extraction/contact-extractor";
import { extractEmails } from "@/lib/extraction/email";
import { isRestrictedSocialHost } from "@/lib/extraction/network";
import type { Lead, LeadKind, SearchInput, SourceType } from "@/lib/types";

interface SourcedResult extends SearchResult {
  source: SourceType;
}

function cleanResultTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(/\s*[|·–—-]\s*(LinkedIn|Instagram|Facebook).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function kindFromResult(result: SourcedResult, input: SearchInput): LeadKind {
  if (input.leadType !== "all") return input.leadType;
  return /\b(agency|studio|company|collective|team)\b/i.test(`${result.title} ${result.snippet}`)
    ? "agency"
    : "person";
}

function socialUrls(source: SourceType, url: string) {
  return {
    linkedinUrl: source === "linkedin" ? url : null,
    instagramUrl: source === "instagram" ? url : null,
    facebookUrl: source === "facebook" ? url : null,
  };
}

function inferredLocation(input: SearchInput): { location: string; country: string } {
  const cities = input.cities.join(", ");
  const countries = input.countries.join(", ");
  if (input.regionMode === "nepal") {
    return { location: cities ? `${cities}, Nepal` : "Nepal", country: "Nepal" };
  }
  if (input.regionMode === "international") {
    return { location: [cities, countries].filter(Boolean).join(", ") || "International", country: countries };
  }
  return { location: [cities, countries].filter(Boolean).join(", ") || "Nepal & international", country: countries };
}

function resultLead(result: SourcedResult, input: SearchInput): Lead {
  const title = cleanResultTitle(result.title) || new URL(result.url).hostname;
  // Social result content is not copied or mined for email addresses. It is
  // retained only as a profile URL for the user's manual review.
  const emails = result.source === "web" ? extractEmails(result.snippet) : [];
  const email = emails[0] ?? null;
  const social = socialUrls(result.source, result.url);
  const place = inferredLocation(input);

  return {
    id: randomUUID(),
    kind: kindFromResult(result, input),
    name: title,
    company: title,
    role: input.roles[0] ?? "Email design",
    email,
    ...place,
    websiteUrl: result.source === "web" ? result.url : null,
    ...social,
    sourceUrl: result.url,
    sourceType: result.source,
    confidence: email ? 78 : 48,
    status: "new",
    emailPublic: Boolean(email),
    evidence: email ? result.snippet.slice(0, 240) : "Public search result; contact details need review.",
    createdAt: new Date().toISOString(),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(values[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runner));
  return results;
}

function mergeKey(lead: Lead): string {
  if (lead.email) return `email:${lead.email.toLowerCase()}`;
  if (lead.websiteUrl) {
    try {
      return `host:${new URL(lead.websiteUrl).hostname.replace(/^www\./, "")}`;
    } catch {
      // Fall through to the normalized company name.
    }
  }
  return `name:${lead.company.toLowerCase().replace(/\W+/g, "")}`;
}

function mergeLeads(leads: Lead[]): Lead[] {
  const merged = new Map<string, Lead>();
  for (const lead of leads) {
    const key = mergeKey(lead);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, lead);
      continue;
    }
    merged.set(key, {
      ...(lead.confidence > previous.confidence ? previous : lead),
      ...(lead.confidence > previous.confidence ? lead : previous),
      linkedinUrl: previous.linkedinUrl ?? lead.linkedinUrl,
      instagramUrl: previous.instagramUrl ?? lead.instagramUrl,
      facebookUrl: previous.facebookUrl ?? lead.facebookUrl,
      websiteUrl: previous.websiteUrl ?? lead.websiteUrl,
      email: previous.email ?? lead.email,
      confidence: Math.max(previous.confidence, lead.confidence),
      emailPublic: previous.emailPublic || lead.emailPublic,
    });
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

export async function discoverLeads(input: SearchInput): Promise<Lead[]> {
  const batches = await Promise.all(
    input.sources.map(async (source) => {
      const results = await braveWebSearch(buildDiscoveryQuery(input, source), source === "web" ? 12 : 8);
      return results.map((result) => ({ ...result, source }));
    }),
  );
  const sourced = batches.flat();
  const baseLeads = sourced.map((result) => resultLead(result, input));

  if (!input.deepScan) return mergeLeads(baseLeads);

  const scanTargets = sourced
    .filter((result) => {
      try {
        return result.source === "web" && !isRestrictedSocialHost(new URL(result.url).hostname);
      } catch {
        return false;
      }
    })
    .filter((result, index, values) => {
      try {
        const host = new URL(result.url).hostname.replace(/^www\./, "");
        return values.findIndex((candidate) => new URL(candidate.url).hostname.replace(/^www\./, "") === host) === index;
      } catch {
        return false;
      }
    })
    .slice(0, 6);

  const scanned = await mapWithConcurrency(scanTargets, 3, async (result) => {
    try {
      const contacts = await scanPublicWebsite(result.url);
      const place = inferredLocation(input);
      return contacts.map<Lead>((contact) => ({
        id: randomUUID(),
        kind: contact.name ? "person" : "agency",
        name: contact.name ?? contact.company,
        company: contact.company,
        role: contact.role ?? input.roles[0] ?? "Email design",
        email: contact.email,
        ...place,
        websiteUrl: new URL(result.url).origin,
        linkedinUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        sourceUrl: contact.sourceUrl,
        sourceType: "web",
        confidence: contact.confidence,
        status: "new",
        emailPublic: true,
        evidence: contact.evidence,
        createdAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  });

  return mergeLeads([...baseLeads, ...scanned.flat()]).slice(0, 60);
}
