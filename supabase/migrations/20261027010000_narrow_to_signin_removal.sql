-- Narrows 20261027000000_anonymous_sessions to the sign-in removal only.
-- Kept: anonymous participants, single-code lookup (no listing), journeys/uploads only inside a
-- session, staff check excludes anonymous users.
-- Restored: the 7-day tracker and Day 7 columns. Deferred: code expiry (NULL = never expires).

alter table public.journeys rename column pdf_downloaded_at to tracker_started_at;
alter table public.journeys
  add column tasks_done smallint not null default 0 check (tasks_done between 0 and 7),
  add column day7_reminder_sent_at timestamptz;
create index journeys_reminder_due on public.journeys (tracker_started_at) where day7_reminder_sent_at is null;

-- Expiry deferred: no default, NULL means the code stays valid.
drop trigger cohorts_expiry on public.cohorts;
drop function public.cohorts_default_expiry();
alter table public.cohorts alter column active_until drop not null;
update public.cohorts set active_until = null;

create or replace function public.cohort_active(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cohorts where id = p_id and (active_until is null or active_until > now()));
$$;

create or replace function public.cohort_by_code(p_code text)
returns table (id uuid, code text, name text, session_date date, active_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.name, c.session_date, c.active_until
  from public.cohorts c
  where c.code = upper(trim(p_code)) and (c.active_until is null or c.active_until > now());
$$;

create or replace function public.has_active_journey()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.journeys j join public.cohorts c on c.id = j.cohort_id
    where j.user_id = auth.uid() and (c.active_until is null or c.active_until > now())
  );
$$;
