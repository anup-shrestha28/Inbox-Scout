function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(safeHeader(value), "utf8").toString("base64")}?=`;
}

export interface MimeInput {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachment?: { bytes: Uint8Array; filename: string } | null;
}

/** Builds a base64url RFC 2822 message in the shape the Gmail API expects. */
export function buildMimeMessage(input: MimeInput): string {
  const boundary = `inboxscout_${crypto.randomUUID().replaceAll("-", "")}`;
  const headers = [
    `To: ${safeHeader(input.to)}`,
    `From: ${safeHeader(input.from)}`,
    `Subject: ${encodedHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(input.body, "utf8").toString("base64")),
  ];

  if (input.attachment) {
    const filename = safeHeader(input.attachment.filename.replace(/["\\]/g, "-")) || "CV.pdf";
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(Buffer.from(input.attachment.bytes).toString("base64")),
    );
  }
  parts.push(`--${boundary}--`, "");

  return Buffer.from([...headers, ...parts].join("\r\n"), "utf8").toString("base64url");
}
