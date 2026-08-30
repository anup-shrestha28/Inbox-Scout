import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { searchDemoLeads } from "@/lib/demo-data";
import {
  isUsableDiscoveryResult,
  matchesRequestedWork,
  resultMatchesTargetRegion,
} from "@/lib/discovery/discover";
import { buildDiscoveryRequest } from "@/lib/discovery/queries";
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
  it("scopes social sources through include_domains, not Google-style operators", () => {
    const request = buildDiscoveryRequest(input, "linkedin");
    assert.deepEqual(request.includeDomains, ["linkedin.com"]);
    assert.equal(request.depth, "basic");
    assert.match(request.query, /Email designer/);
    assert.match(request.query, /Nepal/);
    // Tavily treats these as plain keywords, so they must never appear.
    assert.doesNotMatch(request.query, /site:/);
    assert.doesNotMatch(request.query, /-jobs/);
  });

  it("uses advanced depth for Meta platforms, which basic depth cannot index usefully", () => {
    assert.equal(buildDiscoveryRequest(input, "instagram").depth, "advanced");
    assert.equal(buildDiscoveryRequest(input, "facebook").depth, "advanced");
    assert.deepEqual(buildDiscoveryRequest(input, "facebook").includeDomains, ["facebook.com"]);
  });

  it("adds public contact intent to web searches", () => {
    const request = buildDiscoveryRequest(input, "web");
    assert.equal(request.includeDomains, undefined);
    assert.match(request.query, /email design and Klaviyo services/);
    assert.match(request.query, /official website contact/);
    assert.match(request.query, /-jobs -job -hiring -vacancy/);
  });

  it("strips an injected site operator from user text", () => {
    const request = buildDiscoveryRequest({ ...input, query: "site:private.local hiring" }, "web");
    assert.doesNotMatch(request.query, /site:private\.local/);
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

describe("social result relevance", () => {
  const nepalInput: SearchInput = {
    ...input,
    roles: ["Email designer", "Email marketing agency", "Klaviyo designer"],
    regionMode: "nepal",
    countries: [],
    cities: ["Kathmandu", "Lalitpur"],
    sources: ["linkedin", "instagram", "facebook"],
  };

  it("keeps a LinkedIn profile that genuinely does email work in the region", () => {
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "linkedin",
          title: "Rohan Shrestha - Co-founder @kraft - Kraft Email Marketing Agency",
          url: "https://np.linkedin.com/in/rohan-shrestha-3105531a7",
          snippet: "Kathmandu, Bāgmatī, Nepal · Turning clicks into loyal customers.",
        },
        nepalInput,
      ),
      true,
    );
  });

  it("rejects profiles from unrelated fields even when the region matches", () => {
    // The exact failure the user reported: a UI/UX designer and a student.
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "linkedin",
          title: "Anupama Neupane - Clairify.ai",
          url: "https://www.linkedin.com/in/anupama-neupane/",
          snippet: "UI/UX Designer | Frontend Developer · Kathmandu, Bāgmatī, Nepal",
        },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "linkedin",
          title: "Agrani Thakuri Jha - Self employed",
          url: "https://www.linkedin.com/in/agrani-thakuri-jha-46a93115b/",
          snippet: "Student at St. Mary's high school, kathmandu · Nepal",
        },
        nepalInput,
      ),
      false,
    );
  });

  it("rejects LinkedIn job posts, feed posts, and people directories by URL shape", () => {
    for (const url of [
      "https://np.linkedin.com/jobs/view/email-designer-at-mach33-media-445",
      "https://www.linkedin.com/posts/digital-saugat_email-marketing-nepal",
      "https://www.linkedin.com/pub/dir/Rohan/Shrestha",
    ]) {
      assert.equal(
        isUsableDiscoveryResult(
          { source: "linkedin", title: "Email marketing Nepal", url, snippet: "Kathmandu email marketing" },
          nepalInput,
        ),
        false,
        url,
      );
    }
  });

  it("rejects Facebook event/group posts and keeps real business pages", () => {
    // The fashion-event post the user opened from their results.
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "facebook",
          title: "Mydream TV USA's Post",
          url: "https://www.facebook.com/MydreamTvusa/posts/get-ready-to-witness-elegance/1584",
          snippet: "Miss Nepal contestants shine at the gala",
          },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "facebook",
          title: "Klaviyo Email Marketing Community | Job Post",
          url: "https://www.facebook.com/groups/544033120196337/posts/1342853943647580",
          snippet: "Kathmandu email designer wanted",
        },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "facebook",
          title: "Arambha Marketing Agency | Kathmandu",
          url: "https://www.facebook.com/ArambhaMarketing",
          snippet: "Email marketing campaigns and design for Nepali brands.",
        },
        nepalInput,
      ),
      true,
    );
  });

  it("rejects Instagram posts/keyword pages and keeps relevant profile pages", () => {
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "instagram",
          title: "Digital Marketing Agency in Kathmandu - Nepal",
          url: "https://www.instagram.com/p/DXv0xJwgY1i",
          snippet: "Email marketing Kathmandu",
        },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "instagram",
          title: "Online Marketing In Nepal",
          url: "https://www.instagram.com/popular/online-marketing-in-nepal",
          snippet: "email marketing Kathmandu",
        },
        nepalInput,
      ),
      false,
    );
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "instagram",
          title: "Queens Digital Agency (@queensdigitalnp) · Kathmandu",
          url: "https://www.instagram.com/queensdigitalnp",
          snippet: "Email marketing campaigns, newsletters, and design for brands in Nepal.",
        },
        nepalInput,
      ),
      true,
    );
  });

  it("rejects results from a different platform than the ticked source", () => {
    assert.equal(
      isUsableDiscoveryResult(
        {
          source: "facebook",
          title: "Email marketing agency Kathmandu",
          url: "https://np.linkedin.com/company/kraftemails",
          snippet: "Email marketing Nepal",
        },
        nepalInput,
      ),
      false,
    );
  });

  it("recognizes everyday email-work vocabulary, not only exact role phrases", () => {
    assert.equal(
      matchesRequestedWork(
        {
          title: "Dipesh Shrestha - Co-Founder @ Gre8emails",
          url: "https://np.linkedin.com/in/dipeshrestha82",
          snippet: "Helping DTC brands turn email interactions into incremental revenue. Kathmandu.",
        },
        nepalInput,
      ),
      true,
    );
    assert.equal(
      matchesRequestedWork(
        {
          title: "Hudson Valley Events and Activities",
          url: "https://www.facebook.com/hudsonvalleyevents",
          snippet: "Concerts, festivals, and family activities every weekend.",
        },
        nepalInput,
      ),
      false,
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
