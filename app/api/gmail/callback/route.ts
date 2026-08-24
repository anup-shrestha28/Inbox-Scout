import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requiredEnv } from "@/lib/config";
import { encryptToken } from "@/lib/email/token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/auth";

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function appRedirect(query: string) {
  return NextResponse.redirect(new URL(`/?${query}`, requiredEnv("NEXT_PUBLIC_APP_URL")));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("inboxscout_google_state")?.value;
  cookieStore.delete("inboxscout_google_state");

  if (oauthError) return appRedirect(`gmail=error&reason=${encodeURIComponent(oauthError)}`);
  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return appRedirect("gmail=error&reason=invalid_state");
  }

  try {
    const user = await requireUser();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: requiredEnv("GOOGLE_CLIENT_ID"),
        client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokenResponse.ok || !tokens.access_token) {
      throw new Error(tokens.error_description ?? tokens.error ?? "Google token exchange failed.");
    }

    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const userInfo = (await userInfoResponse.json()) as { email?: string };
    if (!userInfoResponse.ok || !userInfo.email) throw new Error("Unable to read the Gmail address.");

    const admin = createAdminClient();
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const { data: existing } = await admin
        .from("gmail_connections")
        .select("refresh_token_ciphertext,token_iv")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!existing) throw new Error("Google did not issue an offline refresh token. Reconnect with consent.");
      const { error } = await admin
        .from("gmail_connections")
        .update({
          connected_email: userInfo.email,
          scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
        })
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return appRedirect("gmail=connected");
    }

    const encrypted = encryptToken(refreshToken);
    refreshToken = undefined;
    const { error } = await admin.from("gmail_connections").upsert({
      user_id: user.id,
      connected_email: userInfo.email,
      refresh_token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    });
    if (error) throw new Error(error.message);

    return appRedirect("gmail=connected");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "connection_failed";
    return appRedirect(`gmail=error&reason=${encodeURIComponent(reason.slice(0, 120))}`);
  }
}

