-- Per-player, per-week stat lines for the current season, persisted directly from
-- weekly finalization's own already-computed data (tank01ScoringSync.ts) instead of
-- discarding it after using it to compute that week's team totals. This replaces the
-- vulnerable "recompute from a Tank01 season-total aggregate endpoint" approach
-- (tank01SeasonStatsSync.ts) for the CURRENT season specifically: that endpoint can
-- lag behind a game's actual completion by hours, and once a stale/empty result is
-- cached it never self-corrects. Weekly finalization already fetches and correctly
-- computes every rostered player's full stat line (with the ESPN kicker-yardage
-- override, correct DST attribution, etc. already applied) -- persisting that exact
-- computation here means the Lineup page's season stats become a database read that
-- sums these rows, matching the same official number weekly finalization itself
-- already produced, rather than a second, independent computation of "what did this
-- player score."
--
-- One row per rostered player per finalized week (starters AND bench -- the Lineup
-- page shows season stats for bench players too), not just that week's starters.
create table if not exists public.cvc_player_weekly_stat (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  schedule_week_id uuid not null references public.schedule_week(id) on delete cascade,
  week_number integer not null,
  player_id uuid not null references public.player(id) on delete cascade,
  position text not null,
  nfl_team text,
  -- 1 if the player had an actual stat line that week (played, even for 0 fantasy
  -- points), 0 if they didn't (bye, injury, inactive) -- set explicitly here rather
  -- than trusted from any single game's raw provider response, whose "games played"
  -- field is built for a season aggregate, not confirmed reliable per-game.
  games_played integer not null default 0,
  pass_yds numeric, pass_td numeric, pass_int numeric,
  rush_att numeric, rush_yds numeric, rush_td numeric,
  targets numeric, receptions numeric, rec_yds numeric, rec_td numeric,
  fg_made numeric, xp_made numeric,
  sacks numeric, def_int numeric, def_td numeric,
  fantasy_points numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (schedule_week_id, player_id)
);

create index if not exists cvc_player_weekly_stat_season_player_idx
  on public.cvc_player_weekly_stat (season_id, player_id);

alter table public.cvc_player_weekly_stat enable row level security;
revoke all on table public.cvc_player_weekly_stat from anon, authenticated;
grant select, insert, update, delete on table public.cvc_player_weekly_stat to service_role;
