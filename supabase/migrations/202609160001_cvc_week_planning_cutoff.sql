-- Caches each schedule_week's calculated "planning week" cutoff -- 9am ET the Tuesday
-- before that week's actual first kickoff. This is a genuinely separate concept from
-- schedule_week.status (which tracks "has this week's games actually been played,"
-- driven solely by the official finalization sync and must never move early). The
-- planning cutoff answers a different question -- "should owners already be planning
-- for this week" -- and advances on a fixed calendar schedule regardless of whether
-- the games have started yet.
--
-- Refreshed once daily as part of the existing team-schedule-sync job (see
-- runTeamScheduleSync), not computed live on every request: the underlying schedule
-- data barely ever changes, so caching the calculated cutoff keeps every page's read
-- a fast database lookup instead of a live provider call.
create table if not exists public.cvc_week_planning_cutoff (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  week_number integer not null,
  cutoff_at timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (season_id, week_number)
);

alter table public.cvc_week_planning_cutoff enable row level security;
revoke all on table public.cvc_week_planning_cutoff from anon, authenticated;
grant select, insert, update, delete on table public.cvc_week_planning_cutoff to service_role;
