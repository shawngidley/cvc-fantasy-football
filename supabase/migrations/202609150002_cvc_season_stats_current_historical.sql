-- Precomputed, read-fast season stats for the full CVC player pool (rostered players
-- AND free agents both), replacing per-request summing for pages that can show
-- hundreds of players at once (Free Agents, All Players, Watchlist). Refreshed for the
-- affected players right after each week's cvc_player_weekly_stat write (weekly
-- finalization), not on a separate daily cron -- CVC already has exactly one clear,
-- infrequent point where new weekly data lands, so refreshing right there keeps this
-- table always current instead of stale for up to a day.
create table if not exists public.cvc_season_stats_current (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete cascade,
  games_played integer not null default 0,
  pass_yds numeric, pass_td numeric, pass_int numeric,
  rush_att numeric, rush_yds numeric, rush_td numeric,
  targets numeric, receptions numeric, rec_yds numeric, rec_td numeric,
  fg_made numeric, xp_made numeric,
  sacks numeric, def_int numeric, def_td numeric,
  fantasy_points numeric not null default 0,
  fantasy_points_per_game numeric,
  updated_at timestamptz not null default now(),
  unique (season_id, player_id)
);

create index if not exists cvc_season_stats_current_season_idx
  on public.cvc_season_stats_current (season_id);

alter table public.cvc_season_stats_current enable row level security;
revoke all on table public.cvc_season_stats_current from anon, authenticated;
grant select, insert, update, delete on table public.cvc_season_stats_current to service_role;

-- Static, complete historical season stats (2023-2025 and any future closed season),
-- backfilled once per year by a manually-triggered job -- these seasons never change
-- once finalized, so there's no refresh cadence at all, unlike the current-season
-- table above. Keyed by a plain year integer rather than a season_id FK: a player's
-- real NFL stats for a past year don't depend on whether CVC's own season table
-- happens to have a row for that year (it may well not, for years before this app
-- existed).
create table if not exists public.cvc_season_stats_historical (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  player_id uuid not null references public.player(id) on delete cascade,
  games_played integer not null default 0,
  pass_yds numeric, pass_td numeric, pass_int numeric,
  rush_att numeric, rush_yds numeric, rush_td numeric,
  targets numeric, receptions numeric, rec_yds numeric, rec_td numeric,
  fg_made numeric, xp_made numeric,
  sacks numeric, def_int numeric, def_td numeric,
  fantasy_points numeric not null default 0,
  fantasy_points_per_game numeric,
  backfilled_at timestamptz not null default now(),
  unique (year, player_id)
);

create index if not exists cvc_season_stats_historical_year_idx
  on public.cvc_season_stats_historical (year);

alter table public.cvc_season_stats_historical enable row level security;
revoke all on table public.cvc_season_stats_historical from anon, authenticated;
grant select, insert, update, delete on table public.cvc_season_stats_historical to service_role;
