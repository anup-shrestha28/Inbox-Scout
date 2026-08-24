import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

import { extractEmailEvidence, extractEmails, isGenericMailbox } from "@/lib/extraction/email";
import { fetchPublicText, SCANNER_USER_AGENT } from "@/lib/extraction/fetch";
import { assertPublicHttpUrl, isRestrictedSocialHost } from "@/lib/extraction/network";
import type { PublicContact } from "@/lib/types";

const CONTACT_LINK_PATTERN = /contact|about|team|people|career|jobs|work-with|studio/i;
const PERSON_ROLE_PATTERN = /founder|director|designer|marketing|creative|talent|recruit|people|owner|lead/i;

interface PageDocument {
  url: string;
  html: string;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+[|–—-]\s+(home|contact|about|careers?|team).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function organizationName(html: string, fallbackHost: string): string {
  const $ = cheerio.load(html);
  const siteName = $("meta[property='og:site_name']").attr("content")?.trim();
  if (siteName) return cleanTitle(siteName);

  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      const value = JSON.parse($(script).text()) as Record<string, unknown>;
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (
          candidate &&
          typeof candidate === "object" &&
          typeof (candidate as Record<string, unknown>).name === "string"
        ) {
          return cleanTitle((candidate as Record<string, string>).name);
        }
      }
    } catch {
      // Invalid publisher JSON-LD is ignored.
    }
  }

  const title = $("title").first().text();
  if (title) return cleanTitle(title.split(/[|–—]/)[0]);
  return fallbackHost.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");
}

function nearbyIdentity(html: string, email: string): { name: string | null; role: string | null } {
  const $ = cheerio.load(html);
  const anchor = $("a[href^='mailto:']")
    .filter((_index, element) => ($(element).attr("href") ?? "").toLowerCase().includes(email))
    .first();
  if (!anchor.length) return { name: null, role: null };

  const container = anchor.closest("article, li, section, div").first();
  const heading = container.find("h1,h2,h3,h4,strong").first().text().replace(/\s+/g, " ").trim();
  const text = container.text().replace(/\s+/g, " ").trim();
  const roleMatch = text.match(
    /(?:founder|creative director|design director|head of design|senior email designer|email designer|talent manager|recruiter|marketing director)/i,
  );

  const name =
    heading &&
    heading.length <= 80 &&
    !heading.includes("@") &&
    !/contact|email|reach|hello|careers?/i.test(heading)
      ? heading
      : null;

  return { name, role: roleMatch?.[0] ?? null };
}

async function robotsFor(origin: string) {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const response = await fetchPublicText(robotsUrl, { acceptHtml: false, maxBytes: 250_000 });
    return robotsParser(robotsUrl, response.text);
  } catch {
    return robotsParser(robotsUrl, "");
  }
}

function candidateLinks(homeUrl: URL, html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const label = `${$(element).text()} ${href}`;
    if (!CONTACT_LINK_PATTERN.test(label)) return;
    try {
      const url = new URL(href, homeUrl);
      if (url.hostname !== homeUrl.hostname || !["http:", "https:"].includes(url.protocol)) return;
      url.hash = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed site links.
    }
  });

  return [...urls].slice(0, 4);
}

export async function scanPublicWebsite(input: string): Promise<PublicContact[]> {
  const initialUrl = await assertPublicHttpUrl(input);
  if (isRestrictedSocialHost(initialUrl.hostname)) {
    throw new Error("Social platforms are discovered through search results, not scanned directly.");
  }

  const robots = await robotsFor(initialUrl.origin);
  if (robots.isAllowed(initialUrl.toString(), SCANNER_USER_AGENT) === false) {
    throw new Error("The website's robots.txt does not allow this page to be scanned.");
  }

  const home = await fetchPublicText(initialUrl.toString());
  const pages: PageDocument[] = [{ url: home.url.toString(), html: home.text }];
  const links = candidateLinks(home.url, home.text);

  for (const link of links) {
    if (robots.isAllowed(link, SCANNER_USER_AGENT) === false) continue;
    try {
      const page = await fetchPublicText(link);
      pages.push({ url: page.url.toString(), html: page.text });
    } catch {
      // One inaccessible contact page should not discard the rest of the site.
    }
  }

  const company = organizationName(home.text, home.url.hostname);
  const contacts = new Map<string, PublicContact>();

  for (const page of pages) {
    const emails = extractEmails(page.html);
    for (const email of emails) {
      const identity = nearbyIdentity(page.html, email);
      const generic = isGenericMailbox(email);
      const next: PublicContact = {
        name: identity.name,
        company,
        role: identity.role,
        email,
        sourceUrl: page.url,
        evidence: extractEmailEvidence(page.html, email),
        confidence: identity.name ? 94 : generic ? 86 : 90,
      };
      const existing = contacts.get(email);
      if (!existing || next.confidence > existing.confidence) contacts.set(email, next);
    }
  }

  return [...contacts.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

export function looksLikeRelevantRole(value: string): boolean {
  return PERSON_ROLE_PATTERN.test(value);
}
