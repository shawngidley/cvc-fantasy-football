-- Fix a duplicate-player data error from the original 2026 season workbook import.
--
-- The workbook import (provider 'cvc_workbook_2026') created a SECOND player row for
-- DeVonta Smith tagged to the wrong team -- WR, CAR -- instead of matching the
-- existing FantasyPros-sourced row for him (WR, PHI). Heiden's Hardtimes has been
-- rostering, paying, and scoring the real Philadelphia Eagles WR under that wrong row
-- ever since (confirmed live: it already carries a real weekly stat line and a current
-- season-stats row, so this isn't just a roster/contract fix -- his stats need to move
-- too, or they'd silently stop counting for Heiden's Hardtimes the moment the roster
-- row is corrected).
--
-- Wrong duplicate: 25e20772-f149-43e4-bf10-13353abcf9dc (WR, CAR, cvc_workbook_2026)
-- Correct player:  8a60ba10-5815-4710-bee4-edfc5f753df1 (WR, PHI, fantasypros)
--
-- Verified via the debugPlayerDuplicateCheck procedure immediately before writing this
-- that these are the only two rows involved and exactly which tables reference the
-- wrong id (roster_assignment, player_contract, cvc_player_weekly_stat,
-- cvc_season_stats_current -- one row each; everything else below was zero, but is
-- included anyway as a complete, safe no-op for any table with a player_id column).
--
-- This reassigns every reference from the wrong row onto the correct one. It does NOT
-- delete the wrong row -- it's left as an empty, unrostered, un-referenced duplicate
-- rather than risk an FK surprise from something outside this list; it can be removed
-- later once confirmed nothing still points at it.
--
-- Safe to re-run: every statement is a no-op the second time (WHERE player_id =
-- '25e20772-...' matches nothing once the first run has moved every row off it).
--
-- ---------------------------------------------------------------------------------
-- RUN THE PREFLIGHT BELOW FIRST. This script can fail partway through.
-- ---------------------------------------------------------------------------------
-- Four of the tables below are UNIQUE on (something, player_id):
--
--   cvc_player_weekly_stat      unique (schedule_week_id, player_id)
--   cvc_season_stats_current    unique (season_id, player_id)
--   cvc_season_stats_historical unique (year, player_id)
--   player_season_stat          unique (season_id, player_id)
--
-- Reassigning onto the correct id therefore fails with 23505 if the CORRECT row
-- already has a row for the same week/season/year. It very likely does: the correct
-- row is a real, active FantasyPros player, and persistWeeklyStats writes weekly rows
-- for the whole active free-agent pool, not just rostered players
-- (tank01ScoringSync.ts builds fullPlayerPool = rostered + activeFreeAgentPool). So
-- both rows plausibly carry the same weeks, derived from the same Tank01 stat line.
--
-- Everything is wrapped in BEGIN/COMMIT so that failure rolls back cleanly. Without
-- it, roster_assignment and player_contract would move while the stats did not --
-- exactly the half-corrected state the note above warns about, where his stats stop
-- counting for Heiden's Hardtimes.
--
-- Preflight -- expect all zeros; any non-zero row names a table that will collide:
--
--   select 'cvc_player_weekly_stat' as t, count(*) from public.cvc_player_weekly_stat w
--     where w.player_id = '25e20772-f149-43e4-bf10-13353abcf9dc'
--       and exists (select 1 from public.cvc_player_weekly_stat x
--                   where x.player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1'
--                     and x.schedule_week_id = w.schedule_week_id)
--   union all
--   select 'cvc_season_stats_current', count(*) from public.cvc_season_stats_current c
--     where c.player_id = '25e20772-f149-43e4-bf10-13353abcf9dc'
--       and exists (select 1 from public.cvc_season_stats_current x
--                   where x.player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1'
--                     and x.season_id = c.season_id)
--   union all
--   select 'cvc_season_stats_historical', count(*) from public.cvc_season_stats_historical h
--     where h.player_id = '25e20772-f149-43e4-bf10-13353abcf9dc'
--       and exists (select 1 from public.cvc_season_stats_historical x
--                   where x.player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1'
--                     and x.year = h.year)
--   union all
--   select 'player_season_stat', count(*) from public.player_season_stat p
--     where p.player_id = '25e20772-f149-43e4-bf10-13353abcf9dc'
--       and exists (select 1 from public.player_season_stat x
--                   where x.player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1'
--                     and x.season_id = p.season_id);
--
-- If the preflight returns a non-zero count, compare the two rows before choosing:
-- if they hold the same numbers (both derived from the same Tank01 line, which is the
-- expected case) the correct row's are already right and the wrong row's are the
-- redundant copy -- delete those, then re-run this script. If they differ, decide
-- which is authoritative first; do not delete blind.
--
-- Not covered here, deliberately: cvc_fantasypros_news_archive.player_id is an
-- INTEGER FantasyPros id, not a public.player uuid, so it does not reference either
-- of these rows.

begin;

update public.roster_assignment set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.player_contract set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.cvc_player_weekly_stat set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.cvc_season_stats_current set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.cvc_season_stats_historical set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.player_season_stat set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.faab_bid set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.faab_bid set drop_player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where drop_player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.player_right set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.trade_asset set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.auction_nomination set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.weekly_lineup_snapshot set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.planned_lineup_assignment set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.watchlist set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.waiver_restricted_designation set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.draft_pick set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';

commit;

-- Sanity check to run after: should return the correct row (8a60ba10-...) now showing
-- Heiden's Hardtimes' roster/contract/stats, and the wrong row (25e20772-...) showing
-- nothing anywhere.
--
--   select 'correct' as which, * from public.roster_assignment where player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1'
--   union all
--   select 'wrong' as which, * from public.roster_assignment where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
