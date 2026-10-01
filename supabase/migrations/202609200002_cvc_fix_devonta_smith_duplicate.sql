-- Fix a duplicate-player data error from the original 2026 season workbook import.
--
-- The workbook import (provider 'cvc_workbook_2026') created a SECOND player row for
-- DeVonta Smith tagged to the wrong team -- WR, CAR -- instead of matching the
-- existing FantasyPros-sourced row for him (WR, PHI). Heiden's Hardtimes has been
-- rostering, paying, and scoring the real Philadelphia Eagles WR under that wrong row
-- ever since (confirmed live: it already carries a real weekly stat line and a current
-- season-stats row, so this isn't just a roster/contract fix). Update 2026-09-30, after
-- running the preflight below against live data: his stats don't need to MOVE after
-- all -- the correct row already independently carries the complete, more accurate
-- version of the same data (see the two DELETEs' own comment further down for why),
-- so nothing stops counting for Heiden's Hardtimes at any point in this migration.
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
-- UPDATE -- preflight run 2026-09-30, both flagged tables confirmed as the expected
-- "redundant copy" case, with one important wrinkle:
--
--   cvc_player_weekly_stat: weeks 2 and 3 are byte-for-byte identical duplicates under
--   both ids (same stat line, same created_at -- both ids independently resolved to
--   the same real Tank01 box score, since resolveStatLine matches by player name and
--   falls back past team entirely). Week 1 has a row ONLY under the correct id --
--   the wrong id's player row didn't exist yet at Week 1's finalization, so it was
--   never in that week's scoring pool. This is a persisted-cache gap, not a scoring
--   error: official weekly matchup scores are computed live at finalization time and
--   never re-read from this table, so no past matchup result is affected either way.
--
--   cvc_season_stats_current: confirmed as the direct sum of the above -- correct id
--   44.0 pts / 3 games (6.8 + 27.7 + 9.5), wrong id 37.2 pts / 2 games (27.7 + 9.5).
--   The correct id's row is already the complete, accurate aggregate.
--
-- Given that, UPDATE ... SET player_id (the generic approach used for every other
-- table below) is wrong for these two specifically -- it would try to move the wrong
-- id's week-2/3 rows and season-aggregate row onto an id that already holds the same
-- or better data, and fail with 23505 exactly as the preflight predicted. The correct
-- fix is to DELETE the wrong id's rows in these two tables instead of reassigning them.
--
-- Not covered here, deliberately: cvc_fantasypros_news_archive.player_id is an
-- INTEGER FantasyPros id, not a public.player uuid, so it does not reference either
-- of these rows.

begin;

update public.roster_assignment set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
update public.player_contract set player_id = '8a60ba10-5815-4710-bee4-edfc5f753df1' where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
delete from public.cvc_player_weekly_stat where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
delete from public.cvc_season_stats_current where player_id = '25e20772-f149-43e4-bf10-13353abcf9dc';
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
