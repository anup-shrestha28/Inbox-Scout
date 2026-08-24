import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requiredEnv } from "@/lib/config";

function encryptionKey(): Buffer {
  const key = Buffer.from(requiredEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptToken(token: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: `${encrypted.toString("base64")}.${authTag.toString("base64")}`,
    iv: iv.toString("base64"),
  };
}

export function decryptToken(ciphertextWithTag: string, ivBase64: string): string {
  const [ciphertextBase64, tagBase64] = ciphertextWithTag.split(".");
  if (!ciphertextBase64 || !tagBase64) throw new Error("Stored token is malformed.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

