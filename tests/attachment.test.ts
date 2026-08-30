import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMimeMessage } from "@/lib/email/mime";
import { isPdfBytes } from "@/lib/pdf";

const bytes = (value: string) => new Uint8Array(Buffer.from(value, "latin1"));

describe("PDF content validation", () => {
  it("accepts a real PDF", () => {
    assert.equal(isPdfBytes(bytes("%PDF-1.4\n%\xd3\xeb\xe9\xe1")), true);
  });

  it("rejects an Office file renamed to .pdf", () => {
    // A .docx is a ZIP archive, so it starts with the "PK\x03\x04" signature.
    assert.equal(isPdfBytes(bytes("PK\x03\x04\x14\x00\x08\x08")), false);
  });

  it("rejects HTML error pages and empty files", () => {
    assert.equal(isPdfBytes(bytes("<!DOCTYPE html>")), false);
    assert.equal(isPdfBytes(new Uint8Array()), false);
    assert.equal(isPdfBytes(bytes("%PD")), false);
  });
});

describe("outreach message assembly", () => {
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

  it("puts the recipient, sender, and encoded subject in the headers", () => {
    const message = decode(
      buildMimeMessage({
        to: "hello@studio.example",
        from: "me@gmail.com",
        subject: "Application for Studio",
        body: "Hi there",
      }),
    );
    assert.match(message, /^To: hello@studio\.example\r\n/);
    assert.match(message, /\r\nFrom: me@gmail\.com\r\n/);
    assert.match(message, /\r\nSubject: =\?UTF-8\?B\?/);
  });

  it("attaches the CV as a named PDF part", () => {
    const message = decode(
      buildMimeMessage({
        to: "hello@studio.example",
        from: "me@gmail.com",
        subject: "Hello",
        body: "Hi",
        attachment: { bytes: bytes("%PDF-1.4 body"), filename: "My_CV.pdf" },
      }),
    );
    assert.match(message, /Content-Disposition: attachment; filename="My_CV\.pdf"/);
    assert.match(message, /Content-Type: application\/pdf; name="My_CV\.pdf"/);
  });

  it("neutralizes header injection so a smuggled Bcc never becomes a header", () => {
    const message = decode(
      buildMimeMessage({
        to: "hello@studio.example\r\nBcc: sneak@evil.example",
        from: "me@gmail.com",
        subject: "Hello",
        body: "Hi",
      }),
    );
    // The text survives, but folded into the To value rather than its own line.
    assert.doesNotMatch(message, /\r\nBcc:/);
    assert.equal(message.split("\r\n")[0], "To: hello@studio.example Bcc: sneak@evil.example");
  });
});
