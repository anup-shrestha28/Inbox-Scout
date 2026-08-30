import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254",
]);

const RESTRICTED_SOCIAL_DOMAINS = [
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "fb.com",
];

// These sites can be useful discovery indexes, but they are not the contact's
// official website. Scanning them produces unrelated platform/support emails
// and, in some cases, addresses embedded in page data for other listings.
const NON_OFFICIAL_DISCOVERY_DOMAINS = [
  "behance.net",
  "careerjet.com",
  "clutch.co",
  "designrush.com",
  "designcrowd.com",
  "dribbble.com",
  "fiverr.com",
  "glassdoor.com",
  "goodfirms.co",
  "heroagencies.com",
  "indeed.com",
  "itrelevant.com",
  "jobgether.com",
  "jobstreet.com",
  "jooble.org",
  "nepalyp.com",
  "peopleperhour.com",
  "99designs.com",
  "guru.com",
  "remoteok.com",
  "remoteotter.com",
  "scribd.com",
  "shine.com",
  "simplyhired.com",
  "smergers.com",
  "sortlist.com",
  "techbehemoths.com",
  "tiktok.com",
  "toptal.com",
  "twine.net",
  "upwork.com",
  "wellfound.com",
  "weworkremotely.com",
  "ziprecruiter.com",
];

const NON_OFFICIAL_HOST_PARTS = [
  "freelancer.",
  "indeed.",
  "glassdoor.",
  "jobgether.",
  "jobstreet.",
  "jooble.",
  "remoteotter.",
  "shine.",
  "twine.",
  "upwork.",
];

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fec") ||
    normalized.startsWith("fed") ||
    normalized.startsWith("fee") ||
    normalized.startsWith("fef")
  );
}

export function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export function isRestrictedSocialHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return RESTRICTED_SOCIAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function isNonOfficialDiscoveryHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    isRestrictedSocialHost(host) ||
    NON_OFFICIAL_DISCOVERY_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ) ||
    NON_OFFICIAL_HOST_PARTS.some((part) => host === part.slice(0, -1) || host.includes(part))
  );
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only public HTTP and HTTPS pages can be scanned.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local")) {
    throw new Error("Private or local hosts cannot be scanned.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Private network addresses cannot be scanned.");
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("This host does not resolve to a public address.");
  }

  return url;
}
