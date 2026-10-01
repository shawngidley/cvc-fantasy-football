-- Sets a confirmed Tank01 playerID on the real DeVonta Smith (WR, Philadelphia
-- Eagles) so his profile/headshot lookups use the reliable exact-ID path instead of
-- Tank01's name search.
--
-- Root cause (found investigating why his live-scoring/player-card photo was wrong
-- even after 202609200002 fixed the duplicate-player-row issue): Tank01's name search
-- for "DeVonta Smith" is genuinely ambiguous, not broken. It matches TWO real NFL
-- players who share that exact name:
--   - playerID 4594449 -- a Carolina Panthers CB (Notre Dame), returned FIRST
--   - playerID 4241478 -- the Philadelphia Eagles WR this app means (Alabama);
--     confirmed live via getNFLPlayerInfo?getStats=true -- his season stats (19 rec,
--     235 yds, 1 TD, 3 games played) match cvc_season_stats_current's row exactly.
-- The app's own code always took the first array result, so it silently picked the
-- Panthers CB's headshot regardless of which player row the roster pointed to -- this
-- was never about the duplicate-row bug specifically, and would recur for any other
-- same-name collision between two real NFL players. The client-side fix (preferring
-- whichever candidate's team matches the player's own nfl_team, instead of always
-- taking index 0) ships alongside this migration; this migration is the one additional
-- step that removes the ambiguity entirely for this specific player by giving the ID
-- lookup, which both client hooks already prefer whenever a tank01_id is present, a
-- real value to use.
--
-- Safe to re-run: idempotent jsonb merge, same result every time.

update public.player
set metadata = metadata || jsonb_build_object('tank01_id', '4241478')
where id = '8a60ba10-5815-4710-bee4-edfc5f753df1';

-- Sanity check: should show tank01_id in the metadata column.
--   select id, display_name, metadata from public.player where id = '8a60ba10-5815-4710-bee4-edfc5f753df1';
