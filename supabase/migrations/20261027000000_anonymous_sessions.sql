-- Phase 2: participants join anonymously with a session code (no email login) and take home a
-- downloadable 7-day plan. Trainers keep email login. Day 7 reminder emails are removed.

-- ───────────── staff are never anonymous ─────────────
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     and exists (select 1 from public.profiles where id = auth.uid() and role in ('trainer', 'admin'));
$$;

-- ───────────── session codes expire ─────────────
-- Default: end of the day after the session date (Malaysia time); 7 days after creation when undated.
alter table public.cohorts add column active_until timestamptz;

create or replace function public.cohorts_default_expiry()
returns trigger language plpgsql as $$
begin
  if new.active_until is null then
    new.active_until := case
      when new.session_date is not null then ((new.session_date + 2)::timestamp at time zone 'Asia/Kuala_Lumpur')
      else coalesce(new.created_at, now()) + interval '7 days'
    end;
  end if;
  return new;
end $$;
create trigger cohorts_expiry before insert or update on public.cohorts
  for each row execute function public.cohorts_default_expiry();

update public.cohorts set active_until = null;  -- trigger fills the default
alter table public.cohorts alter column active_until set not null;

create or replace function public.cohort_active(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cohorts where id = p_id and active_until > now());
$$;

-- Participants look up ONE code; they can no longer list sessions (and their codes).
create or replace function public.cohort_by_code(p_code text)
returns table (id uuid, code text, name text, session_date date, active_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.name, c.session_date, c.active_until
  from public.cohorts c
  where c.code = upper(trim(p_code)) and c.active_until > now();
$$;
revoke execute on function public.cohort_by_code(text) from public;
grant execute on function public.cohort_by_code(text) to anon, authenticated;

drop policy "cohorts read" on public.cohorts;
create policy "cohorts staff read" on public.cohorts for select to authenticated using (public.is_staff());

-- ───────────── journeys only inside an active session ─────────────
drop policy "journeys owner" on public.journeys;
create policy "journeys owner read" on public.journeys for select to authenticated using (user_id = auth.uid());
create policy "journeys owner insert" on public.journeys for insert to authenticated
  with check (user_id = auth.uid() and public.cohort_active(cohort_id));
create policy "journeys owner update" on public.journeys for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.cohort_active(cohort_id));

-- Uploads need a journey in an active session, so a bare anonymous sign-in cannot store files.
create or replace function public.has_active_journey()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.journeys j join public.cohorts c on c.id = j.cohort_id
    where j.user_id = auth.uid() and c.active_until > now()
  );
$$;

drop policy "evidence owner" on public.evidence_files;
create policy "evidence owner read" on public.evidence_files for select to authenticated using (user_id = auth.uid());
create policy "evidence owner insert" on public.evidence_files for insert to authenticated
  with check (user_id = auth.uid() and public.has_active_journey());

drop policy "evidence objects owner insert" on storage.objects;
create policy "evidence objects owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text and public.has_active_journey());

-- ───────────── tracker → downloadable plan ─────────────
drop index if exists public.journeys_reminder_due;
alter table public.journeys drop column day7_reminder_sent_at;
alter table public.journeys drop column tasks_done;
alter table public.journeys rename column tracker_started_at to pdf_downloaded_at;
