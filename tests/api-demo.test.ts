import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POST as createCampaign } from "@/app/api/campaigns/route";
import { POST as search } from "@/app/api/search/route";

describe("demo API workflow", () => {
  it("runs a complete lead search without external credentials", async () => {
    const response = await search(
      new Request("http://localhost/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "",
          roles: ["Email designer"],
          regionMode: "nepal",
          countries: [],
          cities: ["Kathmandu"],
          sources: ["web", "linkedin"],
          leadType: "all",
          deepScan: true,
        }),
      }),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.demo, true);
    assert.ok(payload.leads.length > 0);
  });

  it("creates a deliberately simulated campaign", async () => {
    const response = await createCampaign(
      new Request("http://localhost/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nepal shortlist",
          subjectTemplate: "Email designer application for {{company}}",
          bodyTemplate: "Hi {{name}}, I would love to contribute to the email design work at {{company}}.",
          leadIds: ["1f188f84-1737-4eb7-93b7-10dc5cb52fb0"],
          cvPath: "demo/cv.pdf",
          dailyLimit: 10,
          sendTimezone: "Asia/Kathmandu",
          sendStart: "09:00",
          sendEnd: "17:00",
          scheduledAt: null,
        }),
      }),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.campaign.status, "scheduled");
    assert.equal(payload.campaign.queued, 1);
  });
});
