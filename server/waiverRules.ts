import { supabase, unwrap } from "./supabase";

/** CVC's actual season-long waiver rules (per commissioner, Sept 2026). */
export const STARTING_FAAB = 30;
export const MIN_ROSTER_SIZE = 15;
export const MAX_ROSTER_SIZE = 22;

/** Remaining season FAAB budget for a franchise: STARTING_FAAB minus every 'won' bid
 * amount this season, across every waiver period (bid-cycle or free-period alike --
 * free-period wins are always $1, which still counts against the season cap). */
export async function getFaabBalance(franchiseId: string, seasonId: string): Promise<number> {
  const periodIds = (unwrap(await supabase.from("waiver_period").select("id").eq("season_id", seasonId)) ?? []).map(period => period.id);
  if (!periodIds.length) return STARTING_FAAB;
  const spent = (unwrap(await supabase.from("faab_bid").select("amount").eq("franchise_id", franchiseId).eq("status", "won").in("waiver_period_id", periodIds)) ?? []).reduce((total, bid) => total + bid.amount, 0);
  return STARTING_FAAB - spent;
}

export type FranchiseStanding = { franchiseId: string; wins: number; losses: number; pointsFor: number };

/** Wins/losses/points-for per franchise from final matchups this season, used for the
 * "worst record wins the tie" rule (fewest wins first, then fewest points-for). Same
 * computation as the overview procedure's standings logic, factored out so the waiver
 * resolution engine doesn't duplicate it. */
export async function computeFranchiseStandings(seasonId: string): Promise<Map<string, FranchiseStanding>> {
  const weeks = unwrap(await supabase.from("schedule_week").select("id").eq("season_id", seasonId)) ?? [];
  const weekIds = weeks.map(week => week.id);
  const franchises = unwrap(await supabase.from("franchise").select("id").eq("is_active", true)) ?? [];
  const standings = new Map<string, FranchiseStanding>(franchises.map(franchise => [franchise.id, { franchiseId: franchise.id, wins: 0, losses: 0, pointsFor: 0 }]));
  if (!weekIds.length) return standings;
  const matchups = unwrap(await supabase.from("matchup").select("home_franchise_id, away_franchise_id, home_score, away_score, result_state").in("schedule_week_id", weekIds).eq("result_state", "final")) ?? [];
  for (const matchup of matchups) {
    const home = standings.get(matchup.home_franchise_id);
    const away = standings.get(matchup.away_franchise_id);
    if (!home || !away) continue;
    const homeScore = Number(matchup.home_score);
    const awayScore = Number(matchup.away_score);
    home.pointsFor += homeScore;
    away.pointsFor += awayScore;
    if (homeScore > awayScore) { home.wins += 1; away.losses += 1; }
    else if (awayScore > homeScore) { away.wins += 1; home.losses += 1; }
  }
  return standings;
}

/** Sorts franchise ids "worst record first" for tie-breaking equal bids: fewest wins
 * first, then fewest points-for. A franchise with no games yet (0-0-0) is treated as
 * the worst possible record, consistent with "worst record wins the tie" intent. */
export function sortByWorstRecordFirst(franchiseIds: string[], standings: Map<string, FranchiseStanding>): string[] {
  return [...franchiseIds].sort((a, b) => {
    const sa = standings.get(a) ?? { wins: 0, losses: 0, pointsFor: 0 };
    const sb = standings.get(b) ?? { wins: 0, losses: 0, pointsFor: 0 };
    if (sa.wins !== sb.wins) return sa.wins - sb.wins;
    return sa.pointsFor - sb.pointsFor;
  });
}

/** Free-period claims are NOT auto-awarded like bid-period FAAB claims are -- the
 * claiming owner must explicitly confirm their own claim before it can ever win the
 * player. A claim never confirmed by the time the period closes is dropped entirely
 * (excluded here), same as any other losing claim -- it still gets marked "lost"
 * elsewhere, it just can never be selected as the winner. Among confirmed claims,
 * ordered purely by current waiver priority (lower number = higher priority = first
 * in line). A confirmed claim from a lower-priority franchise can still win the player
 * outright if a higher-priority franchise's claim was never confirmed -- an
 * unconfirmed claim doesn't block anyone else from winning it, it just can't win
 * itself. */
export function selectFreeAgentCandidates<T extends { franchise_id: string; confirmed_at: string | null }>(bidsForPlayer: T[], waiverPriorityByFranchiseId: Map<string, number | null | undefined>): { orderedCandidateFranchiseIds: string[]; bidByFranchise: Map<string, T> } {
  const confirmedBids = bidsForPlayer.filter(bid => bid.confirmed_at != null);
  const bidByFranchise = new Map(confirmedBids.map(bid => [bid.franchise_id, bid]));
  const orderedCandidateFranchiseIds = Array.from(bidByFranchise.keys()).sort((a, b) => (waiverPriorityByFranchiseId.get(a) ?? Number.MAX_SAFE_INTEGER) - (waiverPriorityByFranchiseId.get(b) ?? Number.MAX_SAFE_INTEGER));
  return { orderedCandidateFranchiseIds, bidByFranchise };
}

/** Ranks EVERY bid-period claim on a single player from best to worst (not just the
 * top-dollar group) -- highest amount first, ties broken worst-record-first. Exposing
 * the full ranking (not just the winner) is what makes a cascade possible: if the top
 * bidder gets bumped by their own roster/budget/max-players cap (see
 * resolveWaiverAssignments below), the player needs to fall through to the next
 * bidder in line rather than going unclaimed. */
export function rankBidPeriodCandidates<T extends { franchise_id: string; amount: number }>(bidsForPlayer: T[], standings: Map<string, FranchiseStanding>): T[] {
  const sorted = [...bidsForPlayer].sort((a, b) => b.amount - a.amount);
  const result: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].amount === sorted[i].amount) j++;
    const tierFranchiseIds = sorted.slice(i, j).map(bid => bid.franchise_id);
    const orderedTierIds = tierFranchiseIds.length > 1 ? sortByWorstRecordFirst(tierFranchiseIds, standings) : tierFranchiseIds;
    const byFranchiseThisTier = new Map(sorted.slice(i, j).map(bid => [bid.franchise_id, bid]));
    for (const franchiseId of orderedTierIds) {
      const bid = byFranchiseThisTier.get(franchiseId);
      if (bid) result.push(bid);
    }
    i = j;
  }
  return result;
}

export type WaiverCandidateBid = {
  id: string;
  franchiseId: string;
  cost: number; // amount for a bid-period claim, always 1 for a free-period claim
  priority: number; // owner-stated priority among their own claims this period -- lower = more wanted
  maxPlayersDesired: number;
  dropPlayerId: string | null;
  // Scopes maxPlayersDesired to bids sharing this same key, within one franchise.
  // Ungrouped bids (the default) all share a single sentinel key ("__all__"), which is
  // exactly today's behavior -- one shared cap across every claim. A bid opted into
  // group_by_position instead uses its player's position as the key, so "1 RB, 1 WR"
  // becomes two independent pools rather than one shared cap of 1.
  groupKey: string;
};

export type FranchiseCapacity = { rosterCount: number; budget: number };

export type WaiverRejectionReason =
  | { type: "max_players_desired"; limit: number }
  | { type: "budget"; cost: number; remaining: number }
  | { type: "roster"; cap: number };

/** The actual cascade: decides, for a whole waiver period at once, which franchise
 * wins each contested player.
 *
 * Each player's `rankedCandidatesByPlayer` list is already ordered best-to-worst
 * (rankBidPeriodCandidates for bid periods, selectFreeAgentCandidates's ordering for
 * free periods). Naively awarding each player to its #1 candidate can push a franchise
 * over its own roster cap, season FAAB budget, or stated max-players-this-period --
 * when an owner has multiple claims that collectively don't fit, THEY decide which of
 * their own claims matter more via `priority` (lower number wins), not bid amount and
 * not processing order. Whichever of their claims get bumped fall through to the next
 * candidate in that player's list (which might belong to a different franchise, who
 * may in turn now be over their own cap -- so this runs in rounds, stable-matching
 * style, until nothing changes) rather than the player going unclaimed.
 *
 * The max-players-desired cap itself is scoped per-franchise by each bid's `groupKey`
 * -- an ungrouped bid shares one pool with every other ungrouped bid from that owner
 * (today's behavior), while a position-grouped bid's cap only counts against that
 * owner's other bids at the same position. Roster cap and season FAAB budget are never
 * grouped -- those are always shared across everything a franchise wins this period.
 *
 * `capacityByFranchise` holds each franchise's PRE-period roster count and remaining
 * season FAAB budget (before anything in this period is awarded) -- this function
 * computes cumulative usage against that baseline itself, in each franchise's own
 * priority order, and never mutates the maps passed in. */
export function resolveWaiverAssignments(
  rankedCandidatesByPlayer: Map<string, WaiverCandidateBid[]>,
  capacityByFranchise: Map<string, FranchiseCapacity>,
  rosterCap: number,
): { winnerByPlayer: Map<string, string>; rejectionReasonByBid: Map<string, WaiverRejectionReason> } {
  const rejected = new Set<string>();
  const rejectionReasonByBid = new Map<string, WaiverRejectionReason>();
  const cursorByPlayer = new Map<string, number>();

  function tentativeLeader(playerId: string): WaiverCandidateBid | null {
    const list = rankedCandidatesByPlayer.get(playerId) ?? [];
    let index = cursorByPlayer.get(playerId) ?? 0;
    while (index < list.length && rejected.has(list[index].id)) index++;
    cursorByPlayer.set(playerId, index);
    return index < list.length ? list[index] : null;
  }

  let changedThisRound = true;
  while (changedThisRound) {
    changedThisRound = false;

    const tentativeByFranchise = new Map<string, WaiverCandidateBid[]>();
    for (const playerId of Array.from(rankedCandidatesByPlayer.keys())) {
      const leader = tentativeLeader(playerId);
      if (!leader) continue;
      const list = tentativeByFranchise.get(leader.franchiseId) ?? [];
      list.push(leader);
      tentativeByFranchise.set(leader.franchiseId, list);
    }

    for (const [franchiseId, tentativeWins] of Array.from(tentativeByFranchise.entries())) {
      const ordered = [...tentativeWins].sort((a, b) => a.priority - b.priority || b.cost - a.cost || a.id.localeCompare(b.id));
      const capacity = capacityByFranchise.get(franchiseId) ?? { rosterCount: 0, budget: 0 };
      let rosterRunning = capacity.rosterCount;
      let budgetRunning = capacity.budget;
      const winsRunningByGroup = new Map<string, number>(); // groupKey -> wins counted against it so far

      for (const bid of ordered) {
        const winsRunning = winsRunningByGroup.get(bid.groupKey) ?? 0;
        if (winsRunning >= bid.maxPlayersDesired) {
          rejected.add(bid.id);
          rejectionReasonByBid.set(bid.id, { type: "max_players_desired", limit: bid.maxPlayersDesired });
          changedThisRound = true;
          continue;
        }
        if (bid.cost > budgetRunning) {
          rejected.add(bid.id);
          rejectionReasonByBid.set(bid.id, { type: "budget", cost: bid.cost, remaining: budgetRunning });
          changedThisRound = true;
          continue;
        }
        const rosterAfter = rosterRunning - (bid.dropPlayerId ? 1 : 0) + 1;
        if (rosterAfter > rosterCap) {
          rejected.add(bid.id);
          rejectionReasonByBid.set(bid.id, { type: "roster", cap: rosterCap });
          changedThisRound = true;
          continue;
        }
        rosterRunning = rosterAfter;
        budgetRunning -= bid.cost;
        winsRunningByGroup.set(bid.groupKey, winsRunning + 1);
      }
    }
  }

  const winnerByPlayer = new Map<string, string>();
  for (const playerId of Array.from(rankedCandidatesByPlayer.keys())) {
    const leader = tentativeLeader(playerId);
    if (leader) winnerByPlayer.set(playerId, leader.id);
  }
  return { winnerByPlayer, rejectionReasonByBid };
}
