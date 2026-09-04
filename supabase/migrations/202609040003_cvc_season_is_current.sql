-- getCurrentLeagueAndSeason() previously picked the season with the highest `year` as
-- "current". That breaks the instant a future season row exists (e.g. to hold next
-- year's tradeable rookie draft picks) -- every part of the app (rosters, standings,
-- waivers, everything) would suddenly treat the future season as active. `status` can't
-- substitute either: confirmed the live 2026 season still shows status='setup' despite
-- being mid-season, so it's not being kept in sync. An explicit flag is the only
-- reliable signal.
alter table public.season
  add column if not exists is_current boolean not null default false;

-- Exactly one season should ever be current at a time.
create unique index if not exists season_one_current_per_league
  on public.season (league_id)
  where is_current;
