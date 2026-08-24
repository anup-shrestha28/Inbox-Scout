import { requiredEnv } from "@/lib/config";

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function braveWebSearch(query: string, count = 10): Promise<SearchResult[]> {
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(Math.min(Math.max(count, 1), 20)));
  endpoint.searchParams.set("safesearch", "strict");
  endpoint.searchParams.set("extra_snippets", "true");

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": requiredEnv("BRAVE_SEARCH_API_KEY"),
    },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Search provider returned HTTP ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as BraveResponse;
  return (payload.web?.results ?? [])
    .filter((item): item is Required<Pick<BraveWebResult, "title" | "url">> & BraveWebResult => {
      if (!item.title || !item.url) return false;
      try {
        return ["http:", "https:"].includes(new URL(item.url).protocol);
      } catch {
        return false;
      }
    })
    .map((item) => ({
      title: item.title,
      url: item.url,
      snippet: [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(" "),
    }));
}
