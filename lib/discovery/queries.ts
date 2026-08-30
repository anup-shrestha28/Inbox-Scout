import type { SearchInput, SourceType } from "@/lib/types";

function safeTerm(value: string): string {
  return value.replace(/["<>]/g, " ").replace(/\bsite:/gi, "").replace(/\s+/g, " ").trim();
}

function quotedOr(values: string[]): string {
  const unique = [...new Set(values.map(safeTerm).filter(Boolean))].slice(0, 8);
  return unique.length > 1 ? `(${unique.map((value) => `"${value}"`).join(" OR ")})` : `"${unique[0]}"`;
}

function locationTerms(input: SearchInput): string {
  const places = [...input.cities, ...input.countries];
  if (input.regionMode === "nepal") places.push("Nepal");
  if (input.regionMode === "both") places.push("Nepal");
  return places.length ? quotedOr(places) : input.regionMode === "international" ? "international remote" : "Nepal";
}

function webServiceIntent(roles: string[]): string {
  const joined = roles.map(safeTerm).join(" ").toLowerCase();
  const services: string[] = [];
  if (joined.includes("email marketing")) services.push("email marketing");
  if (joined.includes("email design") || joined.includes("email designer")) services.push("email design");
  if (joined.includes("klaviyo")) services.push("Klaviyo");
  if (!services.length) services.push(...roles.map(safeTerm).filter(Boolean).slice(0, 3));
  return services.join(" and ");
}

const SOCIAL_DOMAIN: Partial<Record<SourceType, string>> = {
  linkedin: "linkedin.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
};

export interface DiscoveryRequest {
  query: string;
  depth: "basic" | "advanced";
  includeDomains?: string[];
}

function naturalPlaces(input: SearchInput): string[] {
  const places = [...input.cities];
  if (input.regionMode !== "nepal") places.push(...input.countries);
  if (input.regionMode !== "international") places.push("Nepal");
  return [...new Set(places.map(safeTerm).filter(Boolean))].slice(0, 6);
}

export function buildDiscoveryRequest(input: SearchInput, source: SourceType): DiscoveryRequest {
  const extra = safeTerm(input.query);

  const socialDomain = SOCIAL_DOMAIN[source];
  if (socialDomain) {
    // Tavily has no `site:` or `-term` operators — that syntax is treated as
    // ordinary keywords and wrecks relevance. Domain scoping goes through the
    // include_domains API parameter and the query stays natural language.
    const roles = [...new Set(input.roles.map(safeTerm).filter(Boolean))].slice(0, 6);
    const audience =
      input.leadType === "person" ? "profile" : input.leadType === "agency" ? "company" : "";
    const query = [`${roles.join(" or ")} in ${naturalPlaces(input).join(", ")}`, audience, extra]
      .filter(Boolean)
      .join(" ");
    return {
      query,
      // Verified empirically: basic depth returns clean LinkedIn people results,
      // while Facebook/Instagram surface almost nothing without advanced depth.
      depth: source === "linkedin" ? "basic" : "advanced",
      includeDomains: [socialDomain],
    };
  }

  const locations = locationTerms(input);
  const typeTerm =
    input.leadType === "agency"
      ? "agency studio"
      : input.leadType === "person"
        ? "designer specialist"
        : "agency studio designer";

  return {
    query: `${webServiceIntent(input.roles)} services ${locations} ${typeTerm} official website contact ${extra} -jobs -job -hiring -vacancy -linkedin -directory -marketplace`,
    depth: "basic",
  };
}
