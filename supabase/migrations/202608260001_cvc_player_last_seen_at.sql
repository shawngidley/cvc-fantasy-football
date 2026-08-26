-- Tracks whether a player was actually present in the most recent FantasyPros player
-- sync, rather than trusting nfl_team as a signal -- confirmed against live data that
-- nfl_team is essentially never null (2 of 3953 players), because FantasyPros doesn't
-- clear a player's team when they retire, it's their last known team, not a live status.
-- 3953 total players across QB/RB/WR/TE/K/DST is roughly 5-6x a realistic currently-
-- active NFL population (~650-700), consistent with years of retired players having
-- accumulated with nothing ever marking them inactive.
--
-- syncFantasyProsSnapshot sets this to the sync's fetchedAt for every player actually
-- present in that run (new inserts and re-matched existing players alike). Eligible/
-- free-agent queries can then require last_seen_at to match the most recent successful
-- sync's timestamp -- a player who drops off a later sync (because they're no longer on
-- FantasyPros' current list) simply stops getting this bumped, and falls out of
-- eligibility without needing to be deleted or manually marked retired.
alter table public.player add column if not exists last_seen_at timestamptz;
create index if not exists player_last_seen_at_idx on public.player(last_seen_at);
