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

export function buildDiscoveryQuery(input: SearchInput, source: SourceType): string {
  const roles = quotedOr(input.roles);
  const locations = locationTerms(input);
  const extra = safeTerm(input.query);
  const typeTerm =
    input.leadType === "agency"
      ? "agency studio"
      : input.leadType === "person"
        ? "designer specialist"
        : "agency studio designer";

  const base = [roles, locations, typeTerm, extra].filter(Boolean).join(" ");
  if (source === "linkedin") return `site:linkedin.com ${base} -jobs -job -hiring`;
  if (source === "instagram") return `site:instagram.com ${base} -jobs -job -hiring`;
  if (source === "facebook") return `site:facebook.com ${base} -jobs -job -hiring`;
  return `${webServiceIntent(input.roles)} services ${locations} ${typeTerm} official website contact ${extra} -jobs -job -hiring -vacancy -linkedin -directory -marketplace`;
}
