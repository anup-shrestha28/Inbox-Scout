import { randomUUID } from "node:crypto";

import { tavilyWebSearch, type SearchResult } from "@/lib/discovery/tavily";
import { buildDiscoveryRequest } from "@/lib/discovery/queries";
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

// ---------------------------------------------------------------------------
// Social profile URL rules. Search indexes return posts, job listings, and
// directory pages from these platforms; only actual profile/page URLs are
// contactable leads.
// ---------------------------------------------------------------------------

const FACEBOOK_RESERVED_SEGMENTS = new Set([
  "events", "groups", "watch", "marketplace", "gaming", "live", "hashtag", "share",
  "reel", "reels", "stories", "story.php", "permalink.php", "photo", "photos",
  "video", "videos", "posts", "notes", "help", "business", "policies", "legal",
  "login", "public", "search", "people", "directory",
]);

const INSTAGRAM_RESERVED_SEGMENTS = new Set([
  "p", "reel", "reels", "explore", "tv", "stories", "accounts", "popular",
  "directory", "tags", "locations", "web", "about", "legal",
]);

function socialProfilePathAllowed(
  source: SourceType,
  pathname: string,
  leadType: SearchInput["leadType"],
): boolean {
  const segments = pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());

  if (source === "linkedin") {
    if (segments[0] === "in" && segments.length === 2) return leadType !== "agency";
    if (segments[0] === "company" && segments.length >= 2) return leadType !== "person";
    return false;
  }
  if (source === "facebook") {
    if (!segments.length) return false;
    if (segments.some((segment) => FACEBOOK_RESERVED_SEGMENTS.has(segment))) return false;
    if (segments.length === 1) return true; // facebook.com/pagename
    if (segments[0] === "p" && segments.length === 2) return true; // facebook.com/p/Page-Name-123
    if (segments[0] === "pages") return true; // legacy facebook.com/pages/Name/id
    return false;
  }
  if (source === "instagram") {
    return segments.length === 1 && !INSTAGRAM_RESERVED_SEGMENTS.has(segments[0]);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Role relevance. Social snippets cannot be website-scanned, so the title and
// snippet themselves must show evidence of the requested kind of work —
// otherwise students, UI/UX designers, and event posts slip through.
// ---------------------------------------------------------------------------

const GENERIC_ROLE_TAILS = new Set([
  "designer", "designers", "design", "agency", "agencies", "studio", "studios",
  "specialist", "specialists", "expert", "experts", "consultant", "consultants",
  "freelancer", "freelancers", "marketer", "marketers", "manager", "managers",
  "company", "companies", "service", "services", "professional", "professionals",
]);

const GENERIC_SINGLE_TERMS = new Set([
  "email", "digital", "marketing", "design", "creative", "media", "web", "online",
  "brand", "branding", "social", "content",
]);

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/e[-‑]mail/g, "email");
}

function phrasePattern(phrase: string): RegExp {
  const words = phrase
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b${words.join("\\s+")}s?\\b`, "i");
}

export function buildRoleMatchers(input: SearchInput): RegExp[] {
  const phrases = new Set<string>();
  for (const raw of [...input.roles, ...input.query.split(/[,;]/)]) {
    const phrase = normalizeMatchText(raw)
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (phrase.length < 3) continue;
    phrases.add(phrase);
    const words = phrase.split(" ");
    if (words.length >= 2 && GENERIC_ROLE_TAILS.has(words[words.length - 1])) {
      const head = words.slice(0, -1).join(" ");
      // "email marketing agency" → "email marketing" is still distinctive;
      // "email designer" → bare "email" would match contact lines, so skip it.
      if (words.length - 1 >= 2 || !GENERIC_SINGLE_TERMS.has(head)) phrases.add(head);
    }
  }

  const matchers = [...phrases].map(phrasePattern);
  if ([...phrases].some((phrase) => phrase.includes("email"))) {
    // The search is about email work, so recognize its everyday vocabulary too
    // ("turn email interactions into revenue", "newsletter design", Klaviyo...).
    matchers.push(
      /\bemails?\b[^.\n]{0,60}?\b(marketing|market\w*|design\w*|campaign\w*|flows?|automation|templates?|strateg\w*|retention|revenue)\b/i,
      /\b(marketing|design\w*|campaign\w*|flows?|automation|strateg\w*|retention|lifecycle)\b[^.\n]{0,60}?\bemails?\b/i,
      /\b(newsletters?|klaviyo|mailchimp|omnisend)\b/i,
    );
  }
  return matchers;
}

export function matchesRequestedWork(result: SearchResult, input: SearchInput): boolean {
  const text = normalizeMatchText(`${result.title} ${result.snippet}`);
  return buildRoleMatchers(input).some((matcher) => matcher.test(text));
}

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
    // Only actual profile/page URLs; posts, jobs, groups, and directories are noise.
    if (!socialProfilePathAllowed(result.source, pathname, input.leadType)) return false;
    // The profile itself must show evidence of the requested kind of work.
    if (!matchesRequestedWork(result, input)) return false;
  } else if (isNonOfficialDiscoveryHost(host)) {
    return false;
  }

  if (JOB_RESULT_PATTERN.test(`${result.title} ${pathname.replace(/[-_/]/g, " ")}`)) return false;
  return resultMatchesTargetRegion(result, input);
}

function cleanResultTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(/\s*[|·•–—-]\s*(LinkedIn|Instagram|Facebook).*$/i, "")
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

/** Turns raw search titles into a readable name/company for social profiles. */
function socialIdentity(
  result: SourcedResult,
): { name: string; company: string; kind: LeadKind } | null {
  let pathname = "";
  try {
    pathname = new URL(result.url).pathname;
  } catch {
    return null;
  }
  const cleaned = cleanResultTitle(result.title);

  if (result.source === "linkedin") {
    // Person titles look like "Name - Headline | Employer"; keep the headline
    // as the company column so the user sees what the person does.
    const segments = cleaned.split(/\s+[-–—]\s+/);
    if (/^\/in\//.test(pathname)) {
      const name = segments[0]?.trim() || cleaned;
      const headline = segments.slice(1).join(" - ").trim();
      return { name, company: headline.slice(0, 90) || name, kind: "person" };
    }
    const name = segments[0]?.trim() || cleaned;
    return { name, company: name, kind: "agency" };
  }

  // Instagram/Facebook page titles: "Page Name (@handle) · City" / "Page | City".
  const handleMatch = cleaned.match(/^(.*?)\s*\(@([\w.]+)\)/);
  const pathHandle = pathname.split("/").filter(Boolean)[0] ?? "";
  const base = (handleMatch?.[1] ?? cleaned.split(/\s*[|·•]\s*/)[0] ?? cleaned).trim();
  const handle = handleMatch?.[2] ?? (result.source === "instagram" ? pathHandle : "");
  const name = base || (handle ? `@${handle}` : cleaned);
  return { name, company: handle ? `@${handle}` : name, kind: "agency" };
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
  const isSocial = result.source !== "web";
  const emails = isSocial ? [] : extractEmails(result.snippet);
  const email = emails[0] ?? null;
  const social = socialUrls(result.source, result.url);
  const place = verifiedLocation(result, input);
  const identity = isSocial ? socialIdentity(result) : null;
  const snippetEvidence = result.snippet.replace(/\s+/g, " ").trim().slice(0, 240);

  return {
    id: randomUUID(),
    kind: identity?.kind ?? kindFromResult(result, input),
    name: identity?.name ?? title,
    company: identity?.company ?? title,
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
    evidence:
      email || (isSocial && snippetEvidence)
        ? snippetEvidence
        : "Public search result; contact details need review.",
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

/**
 * Canonical profile identity: same LinkedIn profile appears under both
 * np.linkedin.com and www.linkedin.com, so country subdomains are folded away.
 */
export function canonicalProfileKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    let host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/^[a-z]{2}\.linkedin\.com$/.test(host)) host = "linkedin.com";
    return `${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

function mergeKey(lead: Lead): string {
  if (lead.websiteUrl) {
    try {
      return `host:${new URL(lead.websiteUrl).hostname.replace(/^www\./, "")}`;
    } catch {
      // Fall through to the other identifiers.
    }
  }
  if (lead.email) return `email:${lead.email.toLowerCase()}`;
  // Two people at the same agency are different leads; the profile URL is the
  // only safe identity for social results without an email or website.
  const profileKey = canonicalProfileKey(lead.sourceUrl);
  if (profileKey) return `url:${profileKey}`;
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
    input.sources.map(async (source): Promise<SourcedResult[]> => {
      try {
        const request = buildDiscoveryRequest(input, source);
        const results = await tavilyWebSearch(request.query, 12, {
          searchDepth: request.depth,
          includeDomains: request.includeDomains,
        });
        return results.map((result) => ({ ...result, source }));
      } catch (error) {
        // One provider hiccup must not sink the other selected sources.
        console.warn(
          `[discover] ${source} search failed:`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
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
