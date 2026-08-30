import * as cheerio from "cheerio";

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const EMAIL_VALIDATION_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const GENERIC_PREFIXES = new Set([
  "hello",
  "hi",
  "contact",
  "careers",
  "career",
  "jobs",
  "work",
  "info",
  "team",
  "studio",
  "office",
]);
const REJECTED_LOCAL_PARTS = new Set([
  "example",
  "email",
  "name",
  "yourname",
  "username",
  "test",
  "noreply",
  "no-reply",
  "donotreply",
]);
const REJECTED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "sentry.io",
  "wixpress.com",
  "wordpress.org",
]);

function trimEmail(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .split("?")[0]
    .replace(/[),.;:'"\]}>]+$/g, "");
}

export function isUsefulPublicEmail(value: string): boolean {
  const email = trimEmail(value);
  if (email.length > 254 || !EMAIL_VALIDATION_PATTERN.test(email)) return false;

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return false;
  if (REJECTED_LOCAL_PARTS.has(localPart) || REJECTED_DOMAINS.has(domain)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i.test(email)) return false;
  return true;
}

export function extractEmails(input: string): string[] {
  const decoded = input
    .replace(/\s+\[at\]\s+|\s+\(at\)\s+/gi, "@")
    .replace(/\s+\[dot\]\s+|\s+\(dot\)\s+/gi, ".");
  const found = decoded.match(EMAIL_PATTERN) ?? [];
  EMAIL_PATTERN.lastIndex = 0;
  return [...new Set(found.map(trimEmail).filter(isUsefulPublicEmail))];
}

export function extractVisibleEmails(html: string): string[] {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,svg,head").remove();

  const mailLinks = $("a[href^='mailto:']")
    .toArray()
    .map((element) => $(element).attr("href") ?? "")
    .join(" ");
  const visibleText = $.root().text();

  return extractEmails(`${visibleText} ${mailLinks}`);
}

export function isGenericMailbox(email: string): boolean {
  const localPart = trimEmail(email).split("@")[0];
  return GENERIC_PREFIXES.has(localPart);
}

export function extractEmailEvidence(html: string, email: string): string | null {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,svg,head").remove();
  const mailLink = $("a[href^='mailto:']")
    .filter((_index, element) => {
      const href = $(element).attr("href") ?? "";
      return trimEmail(href) === trimEmail(email);
    })
    .first();

  if (mailLink.length) {
    const container = mailLink.closest("article, section, li, div").first();
    const text = (container.text() || mailLink.parent().text()).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 240) : "Published as a mail link on this page.";
  }

  const plainText = $.root().text().replace(/\s+/g, " ").trim();
  const position = plainText.toLowerCase().indexOf(email.toLowerCase());
  if (position < 0) return null;
  return plainText.slice(Math.max(0, position - 80), position + email.length + 100).trim();
}
