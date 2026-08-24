function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 32_768;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function utf8Base64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${utf8Base64(safeHeader(value))}?=`;
}

export function buildMimeMessage(input: {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachment?: { bytes: Uint8Array; filename: string } | null;
}): string {
  const boundary = `inboxscout_${crypto.randomUUID().replaceAll("-", "")}`;
  const headers = [
    `To: ${safeHeader(input.to)}`,
    `From: ${safeHeader(input.from)}`,
    `Subject: ${encodedHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8Base64(input.body)),
  ];

  if (input.attachment) {
    const filename = safeHeader(input.attachment.filename.replace(/["\\]/g, "-"));
    parts.push(
      `--${boundary}`,
      'Content-Type: application/pdf; name="CV.pdf"',
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename=\"${filename || "CV.pdf"}\"`,
      "",
      wrapBase64(bytesToBase64(input.attachment.bytes)),
    );
  }
  parts.push(`--${boundary}--`, "");

  const raw = [...headers, ...parts].join("\r\n");
  return utf8Base64(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function sendGmailMessage(accessToken: string, raw: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message ?? "Gmail rejected the message.");
  }
  return payload as { id: string; threadId: string };
}

