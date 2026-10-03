-- Historical CVC season archive: finalized standings, playoff results, and a
-- champion/runner-up summary for seasons completed before this app existed. Deliberately
-- separate from the live-season schema (season/franchise/matchup), which models an
-- active, in-progress season (rosters, weekly scoring, etc.) and has no good place to
-- hang a finalized, no-longer-changing archive row for a franchise that may since have
-- changed owners or been renamed. One row per team per season here instead, carrying the
-- owner/team name as they were that year.
--
-- Populated by commissioner-supplied data only (pasted standings screenshots/exports),
-- one season at a time, in its own dedicated data migration(s) -- see
-- 202610030003_cvc_season_history_2016_2019.sql for the first batch.

create table if not exists public.cvc_season_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  year integer not null,
  champion_owner_name text,
  champion_team_name text,
  champion_score numeric(10, 2),
  runner_up_owner_name text,
  runner_up_team_name text,
  runner_up_score numeric(10, 2),
  created_at timestamptz not null default now(),
  unique (league_id, year)
);

create table if not exists public.cvc_season_history_standing (
  id uuid primary key default gen_random_uuid(),
  season_history_id uuid not null references public.cvc_season_history(id) on delete cascade,
  division_name text not null,
  owner_name text not null,
  team_name text not null,
  wins integer not null check (wins >= 0),
  losses integer not null check (losses >= 0),
  games_back text,
  points_for numeric(10, 2),
  points_against numeric(10, 2),
  division_wins integer,
  division_losses integer,
  clinched text check (clinched in ('division', 'playoff')),
  standing_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cvc_season_history_playoff_game (
  id uuid primary key default gen_random_uuid(),
  season_history_id uuid not null references public.cvc_season_history(id) on delete cascade,
  round_label text not null,
  owner_a_name text not null,
  score_a numeric(10, 2) not null,
  owner_b_name text not null,
  score_b numeric(10, 2) not null,
  winner_owner_name text not null,
  game_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cvc_season_history_league_year_idx on public.cvc_season_history (league_id, year desc);
create index if not exists cvc_season_history_standing_season_idx on public.cvc_season_history_standing (season_history_id, division_name, standing_order);
create index if not exists cvc_season_history_playoff_game_season_idx on public.cvc_season_history_playoff_game (season_history_id, game_order);

alter table public.cvc_season_history enable row level security;
alter table public.cvc_season_history_standing enable row level security;
alter table public.cvc_season_history_playoff_game enable row level security;

revoke all on table public.cvc_season_history, public.cvc_season_history_standing, public.cvc_season_history_playoff_game from anon, authenticated;
grant select, insert, update, delete on table public.cvc_season_history, public.cvc_season_history_standing, public.cvc_season_history_playoff_game to service_role;
