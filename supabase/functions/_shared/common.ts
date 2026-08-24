import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function verifyCron(request: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = request.headers.get("x-cron-secret");
  return Boolean(expected && provided && expected.length >= 24 && provided === expected);
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Supabase function secrets are missing.");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function decryptRefreshToken(ciphertextWithTag: string, ivBase64: string) {
  const encodedKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!encodedKey) throw new Error("TOKEN_ENCRYPTION_KEY is missing.");
  const keyBytes = base64Bytes(encodedKey);
  if (keyBytes.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must contain 32 bytes.");

  const [ciphertextBase64, tagBase64] = ciphertextWithTag.split(".");
  if (!ciphertextBase64 || !tagBase64) throw new Error("Stored Gmail token is malformed.");
  const encrypted = base64Bytes(ciphertextBase64);
  const tag = base64Bytes(tagBase64);
  const combined = new Uint8Array(encrypted.byteLength + tag.byteLength);
  combined.set(encrypted);
  combined.set(tag, encrypted.byteLength);

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(ivBase64), tagLength: 128 },
    key,
    combined,
  );
  return new TextDecoder().decode(clear);
}

export async function gmailAccessToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth function secrets are missing.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "Unable to refresh Gmail access.");
  }
  return payload.access_token as string;
}

