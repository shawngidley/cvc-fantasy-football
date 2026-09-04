import { supabase, unwrap } from "./supabase";
import { computeFranchiseStandings, getFaabBalance, MAX_ROSTER_SIZE, sortByWorstRecordFirst } from "./waiverRules";
import { computeNextResolutionTime } from "./waiverResolutionTiming";

type PendingBid = { id: string; franchise_id: string; player_id: string; drop_player_id: string | null; amount: number; max_players_desired: number };

export type WaiverAwardResult = { playerName: string; franchiseName: string; amount: number; droppedPlayerName: string | null };
export type WaiverSkipResult = { playerName: string; franchiseName: string; reason: string };
export type WaiverResolutionSummary = {
  periodId: string;
  periodLabel: string;
  playersContested: number;
  awarded: WaiverAwardResult[];
  skipped: WaiverSkipResult[];
  nextPeriodLabel: string | null;
};

async function createNextWaiverPeriod(seasonId: string, previousClosesAt: Date): Promise<string | null> {
  const nextCloses = computeNextResolutionTime(previousClosesAt);
  const label = nextCloses.getUTCDay() === 4 ? "Thursday waiver period" : "Sunday waiver period";
  const created = unwrap(await supabase.from("waiver_period").insert({ season_id: seasonId, label, opens_at: previousClosesAt.toISOString(), closes_at: nextCloses.toISOString(), status: "open" }).select("id, label").single());
  return created?.label ?? null;
}

/** Finds the earliest still-open waiver_period whose closes_at has passed, resolves
 * every contested player in it, and opens the next period. Returns null if nothing is
 * currently due -- the cron calls this on every run (every 5 minutes isn't needed here,
 * but reusing a frequent schedule is harmless since this is a fast no-op the rest of the
 * time); most calls simply find no period past its close time yet. */
export async function resolveOpenWaiverPeriod(): Promise<WaiverResolutionSummary | null> {
  const now = new Date();
  const period = unwrap(await supabase.from("waiver_period").select("id, label, season_id, closes_at").eq("status", "open").lte("closes_at", now.toISOString()).order("closes_at").limit(1).maybeSingle());
  if (!period) return null;

  const seasonId = period.season_id;
  const pendingBids = (unwrap(await supabase.from("faab_bid").select("id, franchise_id, player_id, drop_player_id, amount, max_players_desired").eq("waiver_period_id", period.id).eq("status", "pending")) ?? []) as PendingBid[];

  const involvedPlayerIds = pendingBids.length ? Array.from(new Set(pendingBids.map(bid => bid.player_id))) : ["00000000-0000-0000-0000-000000000000"];
  const [franchisesResult, playersResult, seasonResult, standings] = await Promise.all([
    supabase.from("franchise").select("id, name").eq("is_active", true),
    supabase.from("player").select("id, display_name").in("id", involvedPlayerIds),
    supabase.from("season").select("year").eq("id", seasonId).single(),
    computeFranchiseStandings(seasonId),
  ]);
  const franchiseById = new Map((unwrap(franchisesResult) ?? []).map(row => [row.id, row]));
  const playerById = new Map((unwrap(playersResult) ?? []).map(row => [row.id, row]));
  const seasonYear = unwrap(seasonResult)?.year ?? new Date().getFullYear();

  const byPlayer = new Map<string, PendingBid[]>();
  for (const bid of pendingBids) {
    const list = byPlayer.get(bid.player_id) ?? [];
    list.push(bid);
    byPlayer.set(bid.player_id, list);
  }

  // Resolve the most-contested/highest-value players first, so a franchise's roster cap
  // and per-bid max_players_desired budget get consumed by their most important wins
  // first rather than an arbitrary or low-value one.
  const orderedPlayers = Array.from(byPlayer.entries()).sort((a, b) => Math.max(...b[1].map((bid: PendingBid) => bid.amount)) - Math.max(...a[1].map((bid: PendingBid) => bid.amount)));

  const rosterCount = new Map<string, number>();
  const wonThisCycle = new Map<string, number>();
  const remainingBudget = new Map<string, number>();
  const nextResolutionAt = computeNextResolutionTime(period.closes_at ? new Date(period.closes_at) : now);
  const awarded: WaiverAwardResult[] = [];
  const skipped: WaiverSkipResult[] = [];

  async function getRosterCount(franchiseId: string): Promise<number> {
    const cached = rosterCount.get(franchiseId);
    if (cached !== undefined) return cached;
    const rows = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null)) ?? [];
    rosterCount.set(franchiseId, rows.length);
    return rows.length;
  }

  async function getRemainingBudget(franchiseId: string): Promise<number> {
    const cached = remainingBudget.get(franchiseId);
    if (cached !== undefined) return cached;
    const balance = await getFaabBalance(franchiseId, seasonId);
    remainingBudget.set(franchiseId, balance);
    return balance;
  }

  for (const [playerId, bidsForPlayer] of orderedPlayers) {
    const highestAmount = Math.max(...bidsForPlayer.map((bid: PendingBid) => bid.amount));
    const topBidderFranchiseIds = Array.from(new Set(bidsForPlayer.filter((bid: PendingBid) => bid.amount === highestAmount).map((bid: PendingBid) => bid.franchise_id)));
    const orderedCandidateFranchiseIds = topBidderFranchiseIds.length > 1 ? sortByWorstRecordFirst(topBidderFranchiseIds, standings) : topBidderFranchiseIds;
    const playerName = playerById.get(playerId)?.display_name ?? "Unknown player";

    let winner: PendingBid | null = null;
    for (const franchiseId of orderedCandidateFranchiseIds) {
      const candidateBid = bidsForPlayer.find((bid: PendingBid) => bid.franchise_id === franchiseId && bid.amount === highestAmount)!;
      const franchiseName = franchiseById.get(franchiseId)?.name ?? "Unknown franchise";
      const alreadyWon = wonThisCycle.get(franchiseId) ?? 0;
      if (alreadyWon >= candidateBid.max_players_desired) {
        skipped.push({ playerName, franchiseName, reason: `Already won ${alreadyWon} player${alreadyWon === 1 ? "" : "s"} this period, at their stated max of ${candidateBid.max_players_desired}.` });
        continue;
      }
      const remaining = await getRemainingBudget(franchiseId);
      if (candidateBid.amount > remaining) {
        skipped.push({ playerName, franchiseName, reason: `Bid of $${candidateBid.amount} exceeds their remaining season FAAB budget of $${remaining}.` });
        continue;
      }
      const currentCount = await getRosterCount(franchiseId);
      const willDrop = candidateBid.drop_player_id ? 1 : 0;
      if (currentCount - willDrop + alreadyWon + 1 > MAX_ROSTER_SIZE) {
        skipped.push({ playerName, franchiseName, reason: `Awarding this player would exceed the ${MAX_ROSTER_SIZE}-player CVC roster limit.` });
        continue;
      }
      winner = candidateBid;
      break;
    }

    for (const bid of bidsForPlayer) {
      if (winner && bid.id === winner.id) continue;
      unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: now.toISOString() }).eq("id", bid.id).select("id").single());
    }
    if (!winner) continue;

    const franchise = franchiseById.get(winner.franchise_id);

    if (winner.drop_player_id) {
      unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now.toISOString() }).eq("season_id", seasonId).eq("franchise_id", winner.franchise_id).eq("player_id", winner.drop_player_id).is("released_at", null).select("id"));
      unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", seasonId).eq("franchise_id", winner.franchise_id).eq("player_id", winner.drop_player_id).select("id"));
    }

    unwrap(await supabase.from("roster_assignment").insert({ season_id: seasonId, franchise_id: winner.franchise_id, player_id: playerId, roster_state: "bench", acquired_via: "waiver_bid", locked_until: nextResolutionAt.toISOString() }).select("id").single());
    unwrap(await supabase.from("player_contract").upsert({ season_id: seasonId, franchise_id: winner.franchise_id, player_id: playerId, salary: winner.amount, expires_year: seasonYear, source_marker: "W", contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
    unwrap(await supabase.from("faab_bid").update({ status: "won", resolved_at: now.toISOString() }).eq("id", winner.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: seasonId, franchise_id: winner.franchise_id, transaction_type: "waiver", status: "final", summary: `${franchise?.name ?? "A CVC franchise"} won ${playerName} for $${winner.amount} FAAB (${period.label}).`, details: { faab_bid_id: winner.id, player_id: playerId, amount: winner.amount } }).select("id").single());

    wonThisCycle.set(winner.franchise_id, (wonThisCycle.get(winner.franchise_id) ?? 0) + 1);
    rosterCount.set(winner.franchise_id, (await getRosterCount(winner.franchise_id)) + 1 - (winner.drop_player_id ? 1 : 0));
    remainingBudget.set(winner.franchise_id, (await getRemainingBudget(winner.franchise_id)) - winner.amount);
    awarded.push({ playerName, franchiseName: franchise?.name ?? "Unknown franchise", amount: winner.amount, droppedPlayerName: winner.drop_player_id ? (playerById.get(winner.drop_player_id)?.display_name ?? null) : null });
  }

  unwrap(await supabase.from("waiver_period").update({ status: "final" }).eq("id", period.id).select("id").single());
  const nextPeriodLabel = await createNextWaiverPeriod(seasonId, period.closes_at ? new Date(period.closes_at) : now);

  return { periodId: period.id, periodLabel: period.label, playersContested: byPlayer.size, awarded, skipped, nextPeriodLabel };
}
