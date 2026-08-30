import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTavilyResults } from "@/lib/discovery/tavily";

describe("Tavily search result parsing", () => {
  it("keeps valid web results and maps content to the evidence snippet", () => {
    assert.deepEqual(
      parseTavilyResults({
        results: [
          { title: "Studio", url: "https://studio.example/contact", content: "Email jobs@studio.example" },
        ],
      }),
      [
        { title: "Studio", url: "https://studio.example/contact", snippet: "Email jobs@studio.example" },
      ],
    );
  });

  it("rejects missing, malformed, and non-web URLs", () => {
    assert.deepEqual(
      parseTavilyResults({
        results: [
          { title: "Missing URL" },
          { title: "Bad", url: "not-a-url" },
          { title: "FTP", url: "ftp://example.com/file" },
        ],
      }),
      [],
    );
  });
});
