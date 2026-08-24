import { assertPublicHttpUrl } from "@/lib/extraction/network";

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

export const SCANNER_USER_AGENT =
  "InboxScoutContactResearch/1.0 (+public-contact-research; respects robots.txt)";

async function readLimitedText(response: Response, maxBytes = MAX_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Page exceeded the scanner size limit.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function fetchPublicText(
  input: string,
  options: { acceptHtml?: boolean; maxBytes?: number } = {},
): Promise<{ url: URL; text: string; contentType: string }> {
  let url = await assertPublicHttpUrl(input);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: options.acceptHtml === false ? "text/plain,*/*;q=0.5" : "text/html,application/xhtml+xml",
        "User-Agent": SCANNER_USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response did not include a destination.");
      url = await assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) throw new Error(`Page returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (options.acceptHtml !== false && !contentType.includes("text/html")) {
      throw new Error("The target is not an HTML page.");
    }

    return {
      url,
      text: await readLimitedText(response, options.maxBytes),
      contentType,
    };
  }

  throw new Error("Too many redirects.");
}

