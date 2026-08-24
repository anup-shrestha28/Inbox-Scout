import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hasGmailConfig, isDemoMode, requiredEnv } from "@/lib/config";
import { requireUser } from "@/lib/supabase/auth";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (isDemoMode || !hasGmailConfig()) {
      return NextResponse.json(
        { error: "Configure Google OAuth and turn off demo mode before connecting Gmail." },
        { status: 503 },
      );
    }

    const state = randomBytes(24).toString("base64url");
    const cookieStore = await cookies();
    cookieStore.set("inboxscout_google_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", requiredEnv("GOOGLE_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    if (user.email) url.searchParams.set("login_hint", user.email);

    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=Sign+in+before+connecting+Gmail", new URL(request.url).origin),
    );
  }
}
