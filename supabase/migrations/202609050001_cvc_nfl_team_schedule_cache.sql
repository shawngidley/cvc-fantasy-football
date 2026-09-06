-- Caches each NFL team's bye week and next-upcoming-game info, computed once
-- server-side by a background sync rather than every browser fetching and parsing
-- a full 20-game season schedule per team on every Free Agents page load.
create table if not exists public.nfl_team_schedule_cache (
  nfl_team text primary key,
  bye_week integer,
  next_opponent text,
  next_opponent_is_home boolean,
  next_game_date text,
  next_game_time text,
  synced_at timestamptz not null default now()
);

alter table public.nfl_team_schedule_cache enable row level security;
revoke all on table public.nfl_team_schedule_cache from anon, authenticated;
grant select on table public.nfl_team_schedule_cache to anon, authenticated;
grant select, insert, update, delete on table public.nfl_team_schedule_cache to service_role;
