-- Caches Tank01 season-total stats per player, synced on a commissioner-triggered
-- schedule (see server/tank01SeasonStatsSync.ts) rather than fetched live per request,
-- so list views like Free Agents can show real season stats without a Tank01 call per row.
create table if not exists public.player_season_stat (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete cascade,
  games_played integer,
  pass_yds numeric(8,1),
  pass_td numeric(6,1),
  pass_int numeric(6,1),
  rush_att numeric(6,1),
  rush_yds numeric(8,1),
  rush_td numeric(6,1),
  targets numeric(6,1),
  receptions numeric(6,1),
  rec_yds numeric(8,1),
  rec_td numeric(6,1),
  fg_made numeric(6,1),
  xp_made numeric(6,1),
  sacks numeric(6,1),
  def_int numeric(6,1),
  def_td numeric(6,1),
  fantasy_points numeric(8,2),
  fantasy_points_per_game numeric(8,2),
  provider text not null default 'Tank01',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (season_id, player_id)
);
create index if not exists player_season_stat_season_idx on public.player_season_stat(season_id);
alter table public.player_season_stat enable row level security;
revoke all on table public.player_season_stat from anon, authenticated;
grant select, insert, update, delete on table public.player_season_stat to service_role;
