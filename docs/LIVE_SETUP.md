# Live setup

This guide turns InboxScout's safe demo into a hosted personal application. Complete the sections in order.

## 1. Create and migrate Supabase

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor**.
3. Run the complete contents of [`supabase/migrations/202608240001_initial_schema.sql`](../supabase/migrations/202608240001_initial_schema.sql).
4. Confirm that the `cvs` bucket appears under Storage and is private.
5. Under **Authentication → URL Configuration**, set the production site URL and add:
   - `http://localhost:5000/auth/callback`
   - `https://YOUR_DOMAIN/auth/callback`
6. Keep email magic-link authentication enabled.

The migration creates owner-only Row Level Security policies, a private 10 MB PDF CV bucket, and all application tables and indexes.

Copy these values from **Settings → API Keys** (or the project's **Connect** dialog):

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Publishable key (`sb_publishable_...`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Secret key (`sb_secret_...`) → `SUPABASE_SECRET_KEY` (server only)

## 2. Create the Tavily Search key

1. Create a Tavily account and select the free Researcher plan.
2. Generate a development key and set a conservative monthly credit limit.
3. Save it as `TAVILY_API_KEY` only on the server.

InboxScout calls the official Tavily Search endpoint and never scrapes a search-results page. Review Tavily's current terms for your selected plan. The app deliberately avoids retaining the raw API response.

## 3. Configure Google OAuth and Gmail

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable **Gmail API**.
4. Configure the OAuth consent screen. While the app is personal, keep it in testing/private use and add your own Google account as a test user.
5. Create an **OAuth client ID** of type **Web application**.
6. Add both callback URLs as authorized redirect URIs:
   - `http://localhost:5000/api/gmail/callback`
   - `https://YOUR_DOMAIN/api/gmail/callback`
7. Add these scopes to the consent configuration:
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
8. Save the client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The readonly scope is used only to detect replies in threads created by InboxScout. The sender cannot connect until all Google configuration values are present.

## 4. Create application secrets

Generate two independent secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

- Use the base64 value for `TOKEN_ENCRYPTION_KEY`.
- Use the hex value for `CRON_SECRET`.

`TOKEN_ENCRYPTION_KEY` must contain exactly 32 decoded bytes. Use the exact same value in the Next.js environment and Supabase Edge Function secrets.

Create `.env.local` from `.env.example`, set `NEXT_PUBLIC_DEMO_MODE=false`, and fill every value.

## 5. Deploy the Edge Functions

Install and authenticate the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then link the project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." TOKEN_ENCRYPTION_KEY="..." CRON_SECRET="..."
supabase functions deploy send-campaign-emails --no-verify-jwt
supabase functions deploy sync-gmail-replies --no-verify-jwt
```

The functions disable Supabase JWT verification because they are invoked by Postgres Cron. Each function independently requires the long `x-cron-secret` header. Requests without it receive HTTP 401.

## 6. Enable scheduled sending and reply checks

1. Open [`supabase/cron.sql.example`](../supabase/cron.sql.example).
2. Replace `YOUR_PROJECT_REF` and `YOUR_LONG_RANDOM_CRON_SECRET`.
3. Run it in Supabase SQL Editor.
4. Confirm both jobs under **Integrations → Cron**:
   - `inboxscout-send-campaigns` every two minutes
   - `inboxscout-sync-replies` every fifteen minutes

The sending function processes at most two queued messages per run, observes the configured sending window and rolling daily limit, and retries temporary failures up to two times. A stale sending lock is recovered after fifteen minutes.

## 7. Deploy the web application

Vercel is the simplest host for the Next.js interface:

1. Import the repository into Vercel.
2. Add every variable from `.env.local` to the Vercel project.
3. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin without a trailing slash.
4. Set `GOOGLE_REDIRECT_URI` to `https://YOUR_DOMAIN/api/gmail/callback`.
5. Deploy.
6. Recheck the production callback URLs in both Supabase and Google Cloud.

You can also deploy to any Node.js host that supports `next build` and `next start`.

## 8. Live acceptance checklist

- Sign in using the emailed magic link.
- Upload a small PDF CV and confirm that it appears only in your private `cvs/{user-id}/` folder.
- Connect Gmail and confirm the correct sender address.
- Run a narrow Nepal-only search.
- Open and verify a source URL.
- Approve one contact with an explicitly published business email.
- Create a one-contact campaign with a daily limit of one.
- Confirm the message preview and schedule it during the current Kathmandu sending window.
- Inspect Supabase `campaign_leads` and `email_events` after Cron runs.
- Reply to the test message and confirm the status changes after the reply-sync Cron runs.

Do not broaden the campaign until this one-contact acceptance test succeeds.
