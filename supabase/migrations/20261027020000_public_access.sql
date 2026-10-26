-- The participant tool is public: no session code is needed. A facilitator's code (?c=CODE)
-- still files the participant under that session; otherwise cohort_id stays NULL.

drop policy "journeys owner insert" on public.journeys;
create policy "journeys owner insert" on public.journeys for insert to authenticated
  with check (user_id = auth.uid() and (cohort_id is null or public.cohort_active(cohort_id)));

drop policy "journeys owner update" on public.journeys;
create policy "journeys owner update" on public.journeys for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (cohort_id is null or public.cohort_active(cohort_id)));

-- Uploads still need a journey (so a bare sign-in cannot store files), with or without a session.
create or replace function public.has_active_journey()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.journeys j left join public.cohorts c on c.id = j.cohort_id
    where j.user_id = auth.uid() and (j.cohort_id is null or c.active_until is null or c.active_until > now())
  );
$$;
