import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractEmailEvidence,
  extractEmails,
  extractVisibleEmails,
  isGenericMailbox,
  isUsefulPublicEmail,
} from "@/lib/extraction/email";
import {
  isNonOfficialDiscoveryHost,
  isPrivateIp,
  isRestrictedSocialHost,
} from "@/lib/extraction/network";

describe("public email extraction", () => {
  it("extracts, normalizes, and deduplicates published emails", () => {
    const input = `Write to HELLO@Studio.co or hello@studio.co. Careers: jobs@studio.co?subject=Hi`;
    assert.deepEqual(extractEmails(input), ["hello@studio.co", "jobs@studio.co"]);
  });

  it("recognizes common human-readable obfuscation", () => {
    assert.deepEqual(extractEmails("anisha [at] studio [dot] design"), ["anisha@studio.design"]);
  });

  it("rejects placeholders, no-reply addresses, and asset false positives", () => {
    assert.equal(isUsefulPublicEmail("name@example.com"), false);
    assert.equal(isUsefulPublicEmail("noreply@agency.co"), false);
    assert.equal(isUsefulPublicEmail("hero@2x.png"), false);
    assert.equal(isUsefulPublicEmail("careers@real-agency.co"), true);
  });

  it("identifies generic business mailboxes", () => {
    assert.equal(isGenericMailbox("careers@agency.co"), true);
    assert.equal(isGenericMailbox("maya@agency.co"), false);
  });

  it("captures nearby visible evidence", () => {
    const html = `<section><h2>Careers</h2><p>Send your CV to <a href="mailto:jobs@studio.co">jobs@studio.co</a></p></section>`;
    assert.match(extractEmailEvidence(html, "jobs@studio.co") ?? "", /Send your CV/);
  });

  it("does not extract addresses hidden in scripts or page metadata", () => {
    const html = `
      <html>
        <head><meta content="hidden@tracking.example"></head>
        <body>
          <script>window.data = {"email":"unrelated@gmail.com"}</script>
          <p>Contact <a href="mailto:hello@studio.co">hello@studio.co</a></p>
        </body>
      </html>`;
    assert.deepEqual(extractVisibleEmails(html), ["hello@studio.co"]);
    assert.equal(extractEmailEvidence(html, "unrelated@gmail.com"), null);
  });
});

describe("network scanning guardrails", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.8.2", "192.168.1.3", "169.254.169.254", "::1", "fd00::1", "::ffff:192.168.1.2"]) {
    it(`blocks private address ${address}`, () => assert.equal(isPrivateIp(address), true));
  }

  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
    it(`allows public address ${address}`, () => assert.equal(isPrivateIp(address), false));
  }

  it("recognizes social hosts that must not be directly scanned", () => {
    assert.equal(isRestrictedSocialHost("www.linkedin.com"), true);
    assert.equal(isRestrictedSocialHost("business.instagram.com"), true);
    assert.equal(isRestrictedSocialHost("agency.example"), false);
  });

  it("recognizes job boards and marketplaces as non-official websites", () => {
    assert.equal(isNonOfficialDiscoveryHost("ca.indeed.com"), true);
    assert.equal(isNonOfficialDiscoveryHost("www.freelancer.no"), true);
    assert.equal(isNonOfficialDiscoveryHost("www.shine.com"), true);
    assert.equal(isNonOfficialDiscoveryHost("www.designcrowd.com"), true);
    assert.equal(isNonOfficialDiscoveryHost("agency.com.np"), false);
  });
});
