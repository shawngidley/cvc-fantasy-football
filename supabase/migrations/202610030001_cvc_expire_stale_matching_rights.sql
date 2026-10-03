-- Expires leftover rookie/waiver matching rights now that the 2026 draft/protection
-- window has closed. These rights are only meant to matter up through the auction:
-- when a player with an active right is actually nominated, auction.ts (nominatePlayer)
-- resolves it to 'exercised' or 'declined' on the spot. But nothing ever sunsets a right
-- for a player who was cut/designated with one and then simply never got nominated --
-- that right just sits 'active' forever, and the Free Agents page keeps showing a
-- "Matching rights: <Franchise>" tag for them indefinitely, well past the draft that
-- tag was supposed to be about (commissioner call, Oct 2026: "no players should have
-- the matching rights status anymore, that was just for the protections and the draft").
--
-- Two separate things drive that tag and must both be cleared:
--   1. player_right rows (right_type IN ('rookie_match','waiver_match'), status='active')
--      -- also read by assignRestrictedRight's own "remove or resolve the player's
--      current protection right" guard and by the Protections page's restrictedPlayers
--      list, so leaving these active would keep surfacing the old draft-cycle state
--      there too, not just on Free Agents.
--   2. player_contract.last_cut_by_franchise_id / last_cut_tag_type -- set at the moment
--      a player was cut or restricted-right-designated (assignRestrictedRight,
--      releasePlayer's cutTagType branch), and the ONLY thing freeAgents' "Matching
--      rights" tag actually reads (server/routers/league.ts, the matchingRightsOnly
--      branch and the main-pool cutTags lookup) -- the auction's own resolution path
--      never touches these columns at all, even when it does correctly resolve the
--      underlying player_right.
--
-- PREFLIGHT (run first, review before the UPDATEs below):
--   select pr.id, pr.right_type, pr.status, f.name as franchise, p.display_name as player
--   from player_right pr
--   join franchise f on f.id = pr.franchise_id
--   join player p on p.id = pr.player_id
--   join season s on s.id = pr.season_id and s.is_current = true
--   where pr.right_type in ('rookie_match', 'waiver_match') and pr.status = 'active';
--
--   select pc.id, pc.last_cut_tag_type, f.name as cut_by_franchise, p.display_name as player
--   from player_contract pc
--   join franchise f on f.id = pc.last_cut_by_franchise_id
--   join player p on p.id = pc.player_id
--   join season s on s.id = pc.season_id and s.is_current = true
--   where pc.last_cut_by_franchise_id is not null;

update public.player_right
set status = 'expired', updated_at = now()
where right_type in ('rookie_match', 'waiver_match')
  and status = 'active'
  and season_id = (select id from public.season where is_current = true limit 1);

update public.player_contract
set last_cut_by_franchise_id = null, last_cut_tag_type = null
where last_cut_by_franchise_id is not null
  and season_id = (select id from public.season where is_current = true limit 1);
