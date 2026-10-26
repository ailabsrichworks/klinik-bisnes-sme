-- v3 "Business Gap AI": pathways become cost | content | live | missing, and the trainer
-- dashboard gets programme fit, course interest and marketing opt-in as columns.

-- Old v2 values (attraction / follow) map to missing: they need a fresh v3 diagnosis.
update public.journeys set pathway = 'missing' where pathway is not null and pathway not in ('cost', 'content', 'live', 'missing');
alter table public.journeys
  add constraint journeys_pathway_check check (pathway is null or pathway in ('cost', 'content', 'live', 'missing'));

-- Decided by the app's rules (public/js/rules.mjs → programmeFit), never by the AI.
alter table public.journeys
  add column programme_status text generated always as (state #>> '{programme,status}') stored,
  add column programme        text generated always as (state #>> '{programme,key}') stored,
  add column course_interest  text generated always as (state ->> 'nextStep') stored,
  add column marketing_opt_in boolean generated always as (coalesce(state ->> 'marketingConsent', 'false') = 'true') stored;
