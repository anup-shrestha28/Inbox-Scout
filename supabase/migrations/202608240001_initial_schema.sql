create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.lead_source_type as enum ('web', 'linkedin', 'instagram', 'facebook');
create type public.lead_kind as enum ('agency', 'person');
create type public.lead_status as enum ('new', 'approved', 'rejected', 'contacted', 'replied');
create type public.search_status as enum ('running', 'completed', 'failed');
create type public.campaign_status as enum ('draft', 'scheduled', 'paused', 'completed');
create type public.email_job_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped', 'replied');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_timezone text not null default 'Asia/Kathmandu',
  default_daily_limit integer not null default 15 check (default_daily_limit between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null default '',
  roles text[] not null default '{}',
  region_mode text not null check (region_mode in ('nepal', 'international', 'both')),
  countries text[] not null default '{}',
  cities text[] not null default '{}',
  sources public.lead_source_type[] not null default '{web}',
  lead_type text not null default 'all' check (lead_type in ('all', 'agency', 'person')),
  status public.search_status not null default 'running',
  result_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  search_id uuid references public.searches(id) on delete set null,
  kind public.lead_kind not null default 'agency',
  name text not null,
  company text not null default '',
  role text not null default '',
  email citext,
  location text not null default '',
  country text not null default '',
  website_url text,
  linkedin_url text,
  instagram_url text,
  facebook_url text,
  source_url text not null,
  source_type public.lead_source_type not null,
  confidence integer not null default 0 check (confidence between 0 and 100),
  status public.lead_status not null default 'new',
  email_public boolean not null default false,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index leads_user_email_unique
  on public.leads(user_id, lower(email::text))
  where email is not null;
create index leads_user_status_idx on public.leads(user_id, status, created_at desc);
create index leads_user_company_idx on public.leads(user_id, lower(company));

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  source_type public.lead_source_type not null,
  source_url text not null,
  evidence text,
  created_at timestamptz not null default now(),
  unique (lead_id, source_url)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  subject_template text not null,
  body_template text not null,
  cv_path text,
  daily_limit integer not null default 15 check (daily_limit between 1 and 50),
  send_timezone text not null default 'Asia/Kathmandu',
  send_start time not null default '09:00',
  send_end time not null default '17:00',
  status public.campaign_status not null default 'draft',
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status public.email_job_status not null default 'queued',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  replied_at timestamptz,
  google_message_id text,
  google_thread_id text,
  attempt_count integer not null default 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index campaign_leads_due_idx
  on public.campaign_leads(status, scheduled_for)
  where status = 'queued';
create index campaign_leads_thread_idx
  on public.campaign_leads(google_thread_id)
  where google_thread_id is not null;

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_lead_id uuid not null references public.campaign_leads(id) on delete cascade,
  event_type text not null check (event_type in ('queued', 'sending', 'sent', 'failed', 'skipped', 'replied')),
  detail text,
  created_at timestamptz not null default now()
);

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email citext not null,
  reason text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (user_id, email)
);

create table public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected_email citext not null,
  refresh_token_ciphertext text not null,
  token_iv text not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads
for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at before update on public.campaigns
for each row execute function public.set_updated_at();
create trigger campaign_leads_set_updated_at before update on public.campaign_leads
for each row execute function public.set_updated_at();
create trigger gmail_connections_set_updated_at before update on public.gmail_connections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.searches enable row level security;
alter table public.leads enable row level security;
alter table public.lead_sources enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.email_events enable row level security;
alter table public.suppression_list enable row level security;
alter table public.gmail_connections enable row level security;

create policy "profiles_owner_all" on public.profiles
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "searches_owner_all" on public.searches
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "leads_owner_all" on public.leads
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lead_sources_owner_all" on public.lead_sources
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "campaigns_owner_all" on public.campaigns
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "campaign_leads_owner_all" on public.campaign_leads
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "email_events_owner_all" on public.email_events
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "suppressions_owner_all" on public.suppression_list
for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "gmail_connection_owner_read" on public.gmail_connections
for select to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "cv_owner_select" on storage.objects
for select to authenticated using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv_owner_insert" on storage.objects
for insert to authenticated with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv_owner_update" on storage.objects
for update to authenticated using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv_owner_delete" on storage.objects
for delete to authenticated using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

revoke all on public.gmail_connections from anon;
revoke all on public.gmail_connections from authenticated;
