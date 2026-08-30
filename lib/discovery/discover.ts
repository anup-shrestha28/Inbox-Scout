import { randomUUID } from "node:crypto";

import { tavilyWebSearch, type SearchResult } from "@/lib/discovery/tavily";
import { buildDiscoveryQuery } from "@/lib/discovery/queries";
import { scanPublicWebsite } from "@/lib/extraction/contact-extractor";
import { extractEmails } from "@/lib/extraction/email";
import {
  isNonOfficialDiscoveryHost,
  isRestrictedSocialHost,
} from "@/lib/extraction/network";
import type { Lead, LeadKind, SearchInput, SourceType } from "@/lib/types";

interface SourcedResult extends SearchResult {
  source: SourceType;
}

const JOB_RESULT_PATTERN = /\b(hiring|jobs?|job posting|vacanc(?:y|ies)|salary|apply now)\b/i;

const SOCIAL_SOURCE_DOMAINS: Partial<Record<SourceType, string>> = {
  linkedin: "linkedin.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states": ["united states", "usa", "u.s.a", "u.s."],
  "united kingdom": ["united kingdom", "uk", "u.k."],
};

function normalizedResultText(result: SearchResult): string {
  let url = result.url;
  try {
    url = decodeURIComponent(url);
  } catch {
    // Keep the original URL when it contains malformed escapes.
  }
  return `${result.title} ${result.snippet} ${url}`.toLowerCase();
}

function includesPlace(haystack: string, place: string): boolean {
  const normalized = place.trim().toLowerCase();
  if (!normalized) return false;
  const aliases = COUNTRY_ALIASES[normalized] ?? [normalized];
  return aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
  });
}

export function resultMatchesTargetRegion(result: SearchResult, input: SearchInput): boolean {
  const haystack = normalizedResultText(result);
  let host = "";
  try {
    host = new URL(result.url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const matchesNepal = host.endsWith(".np") || includesPlace(haystack, "Nepal") ||
    input.cities.some((city) => includesPlace(haystack, city));
  const matchesInternational = input.countries.some((country) => includesPlace(haystack, country));

  if (input.regionMode === "nepal") return matchesNepal;
  if (input.regionMode === "international") {
    return input.countries.length ? matchesInternational : true;
  }
  return matchesNepal || (input.countries.length ? matchesInternational : true);
}

function verifiedLocation(result: SearchResult, input: SearchInput): { location: string; country: string } {
  const haystack = normalizedResultText(result);
  let host = "";
  try {
    host = new URL(result.url).hostname.toLowerCase();
  } catch {
    // The result was already URL-validated by the provider parser.
  }

  const matchedCities = input.cities.filter((city) => includesPlace(haystack, city));
  const matchedCountries = input.countries.filter((country) => includesPlace(haystack, country));
  const matchesNepal = host.endsWith(".np") || includesPlace(haystack, "Nepal") ||
    (input.regionMode !== "international" && matchedCities.length > 0);

  if (matchesNepal) {
    const place = matchedCities.length ? `${matchedCities.join(", ")}, Nepal` : "Nepal";
    return {
      location: `${place} (source match)`,
      country: "Nepal",
    };
  }

  const place = [...matchedCities, ...matchedCountries].join(", ");
  return {
    location: place ? `${place} (source match)` : "International (location not specified)",
    country: matchedCountries.join(", "),
  };
}

export function isUsableDiscoveryResult(result: SourcedResult, input: SearchInput): boolean {
  let host: string;
  let pathname: string;
  try {
    const url = new URL(result.url);
    host = url.hostname.toLowerCase().replace(/^www\./, "");
    pathname = url.pathname;
  } catch {
    return false;
  }

  const expectedSocialDomain = SOCIAL_SOURCE_DOMAINS[result.source];
  if (expectedSocialDomain) {
    if (!(host === expectedSocialDomain || host.endsWith(`.${expectedSocialDomain}`))) return false;
  } else if (isNonOfficialDiscoveryHost(host)) {
    return false;
  }

  if (JOB_RESULT_PATTERN.test(`${result.title} ${pathname.replace(/[-_/]/g, " ")}`)) return false;
  return resultMatchesTargetRegion(result, input);
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

function resultLead(result: SourcedResult, input: SearchInput): Lead {
  const title = cleanResultTitle(result.title) || new URL(result.url).hostname;
  // Social result content is not copied or mined for email addresses. It is
  // retained only as a profile URL for the user's manual review.
  const emails = result.source === "web" ? extractEmails(result.snippet) : [];
  const email = emails[0] ?? null;
  const social = socialUrls(result.source, result.url);
  const place = verifiedLocation(result, input);

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
  if (lead.websiteUrl) {
    try {
      return `host:${new URL(lead.websiteUrl).hostname.replace(/^www\./, "")}`;
    } catch {
      // Fall through to the normalized company name.
    }
  }
  if (lead.email) return `email:${lead.email.toLowerCase()}`;
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
      const results = await tavilyWebSearch(buildDiscoveryQuery(input, source), source === "web" ? 12 : 8);
      return results.map((result) => ({ ...result, source }));
    }),
  );
  const sourced = batches.flat().filter((result) => isUsableDiscoveryResult(result, input));
  const baseLeads = sourced.map((result) => resultLead(result, input));

  if (!input.deepScan) return mergeLeads(baseLeads);

  const scanTargets = sourced
    .filter((result) => {
      try {
        const host = new URL(result.url).hostname;
        return result.source === "web" &&
          !isRestrictedSocialHost(host) &&
          !isNonOfficialDiscoveryHost(host);
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
      const place = verifiedLocation(result, input);
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
