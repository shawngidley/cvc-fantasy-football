-- One active roster row per player per season.
--
-- Free-agent claims are now awarded the instant an owner confirms them
-- (awardFreeAgentClaimNow), instead of being batched into one resolveOpenWaiverPeriod
-- pass at period close. That turns a previously serialised, single-threaded award into
-- concurrent ones: during the 9am-1pm ET Sunday window several owners can confirm
-- claims on the same player within milliseconds of each other.
--
-- The application-level "is this player already rostered?" check cannot stop that on
-- its own -- it is a read, so two requests can both read "not rostered" and both then
-- insert. The existing table constraint does not help either: it is
-- (season_id, franchise_id, player_id, acquired_at), which only stops ONE franchise
-- double-rostering a player, not two DIFFERENT franchises each rostering them.
--
-- This partial unique index is what actually serialises it. The second insert fails
-- with 23505, which awardFreeAgentClaimNow catches and reports as "this player was
-- just claimed by another CVC franchise" -- before it has released anything the losing
-- owner offered as a drop.
--
-- Safe for trades: a trade UPDATEs roster_assignment.franchise_id in place
-- (server/routers/league.ts:108) rather than inserting a second active row. Released
-- rows are excluded by the WHERE clause, so re-acquiring a previously dropped player
-- is unaffected.
--
-- If this errors with "could not create unique index", the data already contains a
-- player on two active rosters. That is a real inconsistency, not a migration problem:
-- find them with the query below, fix them, then re-run this.
--
--   select season_id, player_id, count(*), array_agg(franchise_id)
--   from public.roster_assignment
--   where released_at is null
--   group by season_id, player_id
--   having count(*) > 1;

create unique index if not exists roster_assignment_one_active_per_player
  on public.roster_assignment (season_id, player_id)
  where released_at is null;
