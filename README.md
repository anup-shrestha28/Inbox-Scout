# InboxScout

InboxScout is a personal lead-research and responsible job-outreach workspace for email designers. It discovers public agency and professional profiles in Nepal and internationally, extracts explicitly published business contact details from official websites, and sends user-approved Gmail campaigns with a CV.

## What is included

- Nepal, international, and combined search modes
- Brave Search API discovery for web and indexed public profile URLs
- Restricted website scanning with `robots.txt`, SSRF protection, redirect limits, page limits, and response-size limits
- Published-email extraction with evidence and confidence scoring
- Supabase Auth, Postgres, Row Level Security, private CV Storage, and Cron integration
- Lead approval, rejection, filtering, duplicate handling, and safe CSV export
- Gmail OAuth with AES-256-GCM encrypted refresh-token storage
- User-approved campaigns, configurable sending windows, rolling daily limits, retries, suppression enforcement, and reply detection
- Safe demo mode with fictional `.example` contacts and simulated sends
- Responsive desktop and mobile interface

InboxScout does **not** log into or scrape LinkedIn, Instagram, or Facebook. Those sources are represented only by public URLs found through a search index. It does not guess email addresses or send to a lead before campaign approval.

## Run the verified demo

Requirements: Node.js 22 or newer and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The example environment enables demo mode by default, so no external account or API key is required.

The demo exercises the entire interface and server workflow but does not call Brave, Supabase, or Gmail. All demo names, domains, and messages are fictional.

## Verification commands

```bash
npm run typecheck
npm test
npm run build
npm audit
```

## Enable live mode

Follow [docs/LIVE_SETUP.md](docs/LIVE_SETUP.md) to configure Supabase, Brave Search, Google OAuth, the Edge Functions, and Supabase Cron.

The minimum live environment is:

```dotenv
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_APP_URL=https://your-app.example
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
BRAVE_SEARCH_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-app.example/api/gmail/callback
TOKEN_ENCRYPTION_KEY=...
CRON_SECRET=...
```

Never expose `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `CRON_SECRET` in variables prefixed with `NEXT_PUBLIC_`.

## Architecture

```text
Next.js web application
├── Supabase Auth → personal sign-in
├── Brave Search → candidate public URLs
├── Contact extractor → limited official-site scan
├── Supabase Postgres → searches, leads, campaigns, events
├── Supabase Storage → private PDF CV bucket
└── Supabase Cron
    ├── send-campaign-emails Edge Function → Gmail API
    └── sync-gmail-replies Edge Function → Gmail API
```

The primary database migration is at `supabase/migrations/202608240001_initial_schema.sql`. Scheduled function calls are configured from `supabase/cron.sql.example` after replacing its placeholders.

## Important operating rules

- Review the source and evidence for each contact before approval.
- Use a Brave plan that permits your intended handling of search results. InboxScout avoids storing raw API responses and saves only the lead record and source URL needed for review.
- Keep daily sending conservative. The application defaults to 12–15 messages per day and enforces a maximum of 50.
- Honor replies and removal requests by adding contacts to the suppression list.
- Keep the app and OAuth consent screen private while it is only for your own use.
