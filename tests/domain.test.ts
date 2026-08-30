import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { searchDemoLeads } from "@/lib/demo-data";
import { isUsableDiscoveryResult, resultMatchesTargetRegion } from "@/lib/discovery/discover";
import { buildDiscoveryQuery } from "@/lib/discovery/queries";
import { decryptToken, encryptToken } from "@/lib/email/token-crypto";
import { renderTemplate } from "@/lib/template";
import type { SearchInput } from "@/lib/types";
import { campaignInputSchema, searchInputSchema } from "@/lib/validation";

const input: SearchInput = {
  query: "retention",
  roles: ["Email designer", "Klaviyo designer"],
  regionMode: "both",
  countries: ["Australia"],
  cities: ["Kathmandu"],
  sources: ["web", "linkedin"],
  leadType: "all",
  deepScan: true,
};

describe("discovery queries", () => {
  it("uses site-restricted indexed discovery for social sources", () => {
    const query = buildDiscoveryQuery(input, "linkedin");
    assert.match(query, /site:linkedin\.com/);
    assert.match(query, /"Email designer"/);
    assert.match(query, /"Nepal"/);
  });

  it("adds public contact intent to web searches", () => {
    const query = buildDiscoveryQuery(input, "web");
    assert.match(query, /email design and Klaviyo services/);
    assert.match(query, /official website contact/);
    assert.match(query, /-jobs -job -hiring -vacancy/);
  });

  it("strips an injected site operator from user text", () => {
    assert.doesNotMatch(buildDiscoveryQuery({ ...input, query: "site:private.local hiring" }, "web"), /site:private\.local/);
  });

  it("requires evidence that the result matches the requested region", () => {
    const nepalInput = { ...input, regionMode: "nepal" as const, countries: [] };
    assert.equal(
      resultMatchesTargetRegion(
        { title: "Email studio in Kathmandu", url: "https://studio.example/about", snippet: "Based in Nepal" },
        nepalInput,
      ),
      true,
    );
    assert.equal(
      resultMatchesTargetRegion(
        { title: "Email studio", url: "https://studio.example/about", snippet: "A global creative team" },
        nepalInput,
      ),
      false,
    );
  });

  it("rejects job boards, marketplace pages, job posts, and social pages returned as web results", () => {
    const nepalInput = { ...input, regionMode: "nepal" as const, countries: [] };
    assert.equal(
      isUsableDiscoveryResult(
        { source: "web", title: "Email Designer Jobs", url: "https://ca.indeed.com/jobs?q=email", snippet: "Nepal" },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        { source: "web", title: "Klaviyo Designer", url: "https://freelancer.co.za/projects/design", snippet: "Nepal" },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        { source: "web", title: "Studio hiring email designer", url: "https://studio.com/careers", snippet: "Kathmandu" },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        { source: "web", title: "Nepal email designer", url: "https://np.linkedin.com/in/designer", snippet: "Kathmandu" },
        nepalInput,
      ),
      false,
    );
  });

  it("keeps a region-matched official website", () => {
    const nepalInput = { ...input, regionMode: "nepal" as const, countries: [] };
    assert.equal(
      isUsableDiscoveryResult(
        { source: "web", title: "Acme Email Studio", url: "https://acme.com.np/contact", snippet: "Kathmandu creative team" },
        nepalInput,
      ),
      true,
    );
  });
});

describe("templates and validation", () => {
  it("renders both single- and double-brace tokens with safe fallbacks", () => {
    assert.equal(
      renderTemplate("Hi {{name}}, {company} needs {role}", { company: "Studio" }),
      "Hi there, Studio needs email design",
    );
  });

  it("validates a complete search and rejects searches with no role", () => {
    assert.equal(searchInputSchema.safeParse(input).success, true);
    assert.equal(searchInputSchema.safeParse({ ...input, roles: [] }).success, false);
  });

  it("caps campaign daily volume", () => {
    const base = {
      name: "Campaign",
      subjectTemplate: "Hello {{company}}",
      bodyTemplate: "This is a sufficiently long and thoughtful email body.",
      leadIds: ["1f188f84-1737-4eb7-93b7-10dc5cb52fb0"],
      cvPath: null,
      dailyLimit: 51,
      sendTimezone: "Asia/Kathmandu",
      sendStart: "09:00",
      sendEnd: "17:00",
      scheduledAt: null,
    };
    assert.equal(campaignInputSchema.safeParse(base).success, false);
    assert.equal(campaignInputSchema.safeParse({ ...base, dailyLimit: 15 }).success, true);
  });
});

describe("demo workflow data", () => {
  it("supports Nepal and international filtering", () => {
    const nepal = searchDemoLeads({ ...input, query: "", regionMode: "nepal", countries: [], sources: ["web", "linkedin"] });
    assert.ok(nepal.length > 0);
    assert.equal(nepal.every((lead) => lead.country === "Nepal"), true);

    const international = searchDemoLeads({ ...input, query: "", regionMode: "international", sources: ["web", "linkedin", "instagram", "facebook"] });
    assert.ok(international.length > 0);
    assert.equal(international.every((lead) => lead.country !== "Nepal"), true);
  });
});

describe("Gmail token encryption", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips a refresh token using authenticated encryption", () => {
    const encrypted = encryptToken("refresh-token-secret");
    assert.equal(encrypted.ciphertext.includes("refresh-token-secret"), false);
    assert.equal(decryptToken(encrypted.ciphertext, encrypted.iv), "refresh-token-secret");
  });

  it("rejects ciphertext that has been modified", () => {
    const encrypted = encryptToken("refresh-token-secret");
    const tampered = `${encrypted.ciphertext.slice(0, 4)}A${encrypted.ciphertext.slice(5)}`;
    assert.throws(() => decryptToken(tampered, encrypted.iv));
  });
});
