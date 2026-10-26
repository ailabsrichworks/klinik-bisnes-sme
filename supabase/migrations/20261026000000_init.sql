-- KBSME Quick Fix AI — initial schema.
-- Run once against a fresh Supabase project (SQL editor or `supabase db push`).

-- ───────────────────────── profiles ─────────────────────────
-- One row per auth user. Role decides what the trainer dashboard can see.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'participant' check (role in ('participant', 'trainer', 'admin')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('trainer', 'admin'));
$$;

-- ───────────────────────── cohorts ─────────────────────────
-- A live 2-hour session. Participants join with the cohort code (?c=CODE in the link).
create table public.cohorts (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9-]{3,24}$'),
  name          text not null,
  session_date  date,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ───────────────────────── journeys ─────────────────────────
-- A participant's working state for one cohort. `state` mirrors the browser app's
-- state object; the extracted columns exist for the trainer dashboard and reminders.
create table public.journeys (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  cohort_id           uuid references public.cohorts(id) on delete set null,
  state               jsonb not null default '{}'::jsonb,
  business_name       text generated always as (state #>> '{profile,business}') stored,
  pathway             text,
  step                smallint not null default 0 check (step between 0 and 4),
  tasks_done          smallint not null default 0 check (tasks_done between 0 and 7),
  tracker_started_at  timestamptz,
  day7_reminder_sent_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index journeys_one_per_cohort on public.journeys (user_id, coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index journeys_cohort on public.journeys (cohort_id);
create index journeys_reminder_due on public.journeys (tracker_started_at) where day7_reminder_sent_at is null;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger journeys_touch before update on public.journeys
  for each row execute function public.touch_updated_at();

-- ───────────────────────── consents ─────────────────────────
-- Append-only record of what the participant agreed to, and against which notice version.
create table public.consents (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('privacy_notice', 'ai_processing', 'marketing')),
  granted         boolean not null,
  notice_version  text not null,
  created_at      timestamptz not null default now()
);
create index consents_user on public.consents (user_id, kind, created_at desc);

-- ───────────────────────── evidence files ─────────────────────────
create table public.evidence_files (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  journey_id    uuid references public.journeys(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    integer not null check (size_bytes <= 4194304),
  created_at    timestamptz not null default now()
);

-- ───────────────────────── AI call log ─────────────────────────
-- Written only by the server (service role). Used for per-user daily limits and cost tracking.
create table public.ai_calls (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  model          text not null,
  status         text not null check (status in ('ok', 'refusal', 'error')),
  input_tokens   integer,
  output_tokens  integer,
  created_at     timestamptz not null default now()
);
create index ai_calls_user_day on public.ai_calls (user_id, created_at desc);

-- ───────────────────────── row level security ─────────────────────────
alter table public.profiles       enable row level security;
alter table public.cohorts        enable row level security;
alter table public.journeys       enable row level security;
alter table public.consents       enable row level security;
alter table public.evidence_files enable row level security;
alter table public.ai_calls       enable row level security;

-- profiles: see/edit yourself (role can't be self-promoted); staff can read everyone
create policy "profiles self read"  on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "profiles self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Participants may only change their name; roles are set by an admin in the SQL editor.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- cohorts: any signed-in user can look up a cohort (needed to join by code); staff manage them
create policy "cohorts read"   on public.cohorts for select to authenticated using (true);
create policy "cohorts insert" on public.cohorts for insert to authenticated with check (public.is_staff());
create policy "cohorts update" on public.cohorts for update to authenticated using (public.is_staff());

-- journeys: owner has full access; staff read-only
create policy "journeys owner"  on public.journeys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "journeys staff read" on public.journeys for select to authenticated using (public.is_staff());

-- consents: owner can insert and read their own; no updates or deletes (append-only)
create policy "consents owner insert" on public.consents for insert to authenticated with check (user_id = auth.uid());
create policy "consents owner read"   on public.consents for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- evidence_files: owner only
create policy "evidence owner" on public.evidence_files for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_calls: no client policies → only the service role can read/write.

-- ───────────────────────── storage ─────────────────────────
-- Private bucket; each user writes only under their own folder: {user_id}/{file}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 4194304,
        array['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'application/pdf']);

create policy "evidence objects owner read" on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "evidence objects owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "evidence objects owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
