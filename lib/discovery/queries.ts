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

export function buildDiscoveryQuery(input: SearchInput, source: SourceType): string {
  const roles = quotedOr(input.roles);
  const locations = locationTerms(input);
  const extra = safeTerm(input.query);
  const typeTerm =
    input.leadType === "agency"
      ? "agency studio"
      : input.leadType === "person"
        ? "designer specialist"
        : "agency OR designer";

  const base = [roles, locations, typeTerm, extra].filter(Boolean).join(" ");
  if (source === "linkedin") return `site:linkedin.com ${base}`;
  if (source === "instagram") return `site:instagram.com ${base}`;
  if (source === "facebook") return `site:facebook.com ${base}`;
  return `${base} (contact OR careers OR jobs OR team)`;
}

