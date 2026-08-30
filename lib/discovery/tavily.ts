import { requiredEnv } from "@/lib/config";

interface TavilyWebResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyWebResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function parseTavilyResults(payload: TavilyResponse): SearchResult[] {
  return (payload.results ?? [])
    .filter((item): item is Required<Pick<TavilyWebResult, "title" | "url">> & TavilyWebResult => {
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
      snippet: item.content ?? "",
    }));
}

export interface TavilySearchOptions {
  /** "advanced" costs twice the credits but is required for usable Facebook/Instagram coverage. */
  searchDepth?: "basic" | "advanced";
  /** Real domain filtering. Tavily ignores Google-style `site:` text in the query. */
  includeDomains?: string[];
}

export async function tavilyWebSearch(
  query: string,
  count = 10,
  options: TavilySearchOptions = {},
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${requiredEnv("TAVILY_API_KEY")}`,
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: options.searchDepth ?? "basic",
      max_results: Math.min(Math.max(count, 1), 20),
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      ...(options.includeDomains?.length ? { include_domains: options.includeDomains } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Search provider returned HTTP ${response.status}: ${detail}`);
  }

  return parseTavilyResults((await response.json()) as TavilyResponse);
}
