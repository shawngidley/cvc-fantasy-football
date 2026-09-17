import { supabase, unwrap } from "./supabase";
import { computeFranchiseStandings, getFaabBalance, MAX_ROSTER_SIZE, rankBidPeriodCandidates, resolveWaiverAssignments, selectFreeAgentCandidates, sortByWorstRecordFirst, type WaiverCandidateBid } from "./waiverRules";
import { computeNextResolutionTime, nextEasternWeekdayAt, sameEasternDayAt } from "./waiverResolutionTiming";

type PendingBid = { id: string; franchise_id: string; player_id: string; drop_player_id: string | null; amount: number; max_players_desired: number; priority: number; confirmed_at: string | null };

export type WaiverAwardResult = { playerName: string; franchiseName: string; amount: number; droppedPlayerName: string | null };
export type WaiverSkipResult = { playerName: string; franchiseName: string; reason: string };
export type WaiverResolutionSummary = {
  periodId: string;
  periodLabel: string;
  periodType: "bid" | "free";
  playersContested: number;
  awarded: WaiverAwardResult[];
  skipped: WaiverSkipResult[];
  nextPeriodLabel: string | null;
};

/** The type of the period that opens right after a period closing on `closesAt`.
 * Sunday's 9am close opens the free period (bid-exempt, flat $1, waiver-priority
 * ordered) immediately, but it only runs until 1pm ET the same day -- not through
 * Thursday. After that 1pm close, bidding is closed entirely until the next bid
 * period opens Tuesday 9am ET (a real gap, unlike every other transition, which
 * reopens immediately). Thursday's 9am close always reopens a normal bid period
 * immediately, running through Sunday. */
function nextPeriodType(previousPeriodType: "bid" | "free", closesAt: Date): "bid" | "free" {
  if (previousPeriodType === "free") return "bid"; // the free period always transitions to the next bid period
  return closesAt.getUTCDay() === 0 ? "free" : "bid"; // a bid period closing Sunday opens the free period; Thursday opens the next bid period
}

async function createNextWaiverPeriod(seasonId: string, previousClosesAt: Date, previousPeriodType: "bid" | "free"): Promise<string | null> {
  const type = nextPeriodType(previousPeriodType, previousClosesAt);
  let opensAt: Date;
  let nextCloses: Date;
  if (previousPeriodType === "free") {
    // Free period just closed at 1pm Sunday ET -- next bid period doesn't open until
    // Tuesday 9am ET, a real gap with nothing open in between.
    opensAt = nextEasternWeekdayAt(previousClosesAt, 2, 9); // 2 = Tuesday
    nextCloses = computeNextResolutionTime(opensAt); // that week's Thursday 9am ET
  } else if (type === "free") {
    // Sunday 9am bid period just resolved -- free period opens immediately, same day,
    // closing at 1pm ET (not the next Thu/Sun 9am).
    opensAt = previousClosesAt;
    nextCloses = sameEasternDayAt(previousClosesAt, 13);
  } else {
    // Thursday 9am bid period just resolved -- next bid period opens immediately,
    // closing Sunday 9am ET.
    opensAt = previousClosesAt;
    nextCloses = computeNextResolutionTime(previousClosesAt);
  }
  const label = type === "free" ? "Free agent period (waiver priority, $1)" : (nextCloses.getUTCDay() === 4 ? "Thursday waiver period" : "Sunday waiver period");
  const created = unwrap(await supabase.from("waiver_period").insert({ season_id: seasonId, label, opens_at: opensAt.toISOString(), closes_at: nextCloses.toISOString(), status: "open", period_type: type }).select("id, label").single());
  return created?.label ?? null;
}

/** Ensures every active franchise has a waiver_priority before the free period is
 * resolved. Franchises that have never been assigned one (fresh season, or a franchise
 * that's simply never won a free-period claim yet) default to worst-record-first, the
 * standard "team with the worst record gets first crack at waivers" convention. */
async function ensureWaiverPriorityBootstrapped(seasonId: string): Promise<void> {
  const franchises = unwrap(await supabase.from("franchise").select("id, waiver_priority").eq("is_active", true)) ?? [];
  const unassigned = franchises.filter(row => row.waiver_priority == null).map(row => row.id);
  if (!unassigned.length) return;
  const standings = await computeFranchiseStandings(seasonId);
  const ordered = sortByWorstRecordFirst(unassigned, standings);
  const maxAssigned = Math.max(0, ...franchises.map(row => row.waiver_priority ?? 0));
  for (let index = 0; index < ordered.length; index++) {
    unwrap(await supabase.from("franchise").update({ waiver_priority: maxAssigned + index + 1 }).eq("id", ordered[index]).select("id").single());
  }
}

/** Finds the earliest still-open waiver_period whose closes_at has passed, resolves
 * every contested player in it, and opens the next period. Returns null if nothing is
 * currently due -- the cron calls this every 15 minutes; most calls simply find no
 * period past its close time yet, which is a fast no-op. */
export async function resolveOpenWaiverPeriod(): Promise<WaiverResolutionSummary | null> {
  const now = new Date();
  const period = unwrap(await supabase.from("waiver_period").select("id, label, season_id, closes_at, period_type").eq("status", "open").lte("closes_at", now.toISOString()).order("closes_at").limit(1).maybeSingle());
  if (!period) return null;

  const seasonId = period.season_id;
  const periodType = (period.period_type ?? "bid") as "bid" | "free";
  const pendingBids = (unwrap(await supabase.from("faab_bid").select("id, franchise_id, player_id, drop_player_id, amount, max_players_desired, priority, confirmed_at").eq("waiver_period_id", period.id).eq("status", "pending")) ?? []) as PendingBid[];

  if (periodType === "free" && pendingBids.length) await ensureWaiverPriorityBootstrapped(seasonId);

  const involvedPlayerIds = pendingBids.length ? Array.from(new Set(pendingBids.map(bid => bid.player_id))) : ["00000000-0000-0000-0000-000000000000"];
  const [franchisesResult, playersResult, seasonResult, standings] = await Promise.all([
    supabase.from("franchise").select("id, name, waiver_priority").eq("is_active", true),
    supabase.from("player").select("id, display_name").in("id", involvedPlayerIds),
    supabase.from("season").select("year").eq("id", seasonId).single(),
    computeFranchiseStandings(seasonId),
  ]);
  const franchiseRows = unwrap(franchisesResult) ?? [];
  const franchiseById = new Map(franchiseRows.map(row => [row.id, row]));
  const playerById = new Map((unwrap(playersResult) ?? []).map(row => [row.id, row]));
  const seasonYear = unwrap(seasonResult)?.year ?? new Date().getFullYear();

  const byPlayer = new Map<string, PendingBid[]>();
  for (const bid of pendingBids) {
    const list = byPlayer.get(bid.player_id) ?? [];
    list.push(bid);
    byPlayer.set(bid.player_id, list);
  }

  // Deterministic display/commit order only -- the actual winner-per-player decision
  // below comes from resolveWaiverAssignments, not from this ordering.
  const orderedPlayers = Array.from(byPlayer.entries()).sort((a, b) => Math.max(...b[1].map((bid: PendingBid) => bid.amount)) - Math.max(...a[1].map((bid: PendingBid) => bid.amount)));

  const rosterCount = new Map<string, number>();
  const remainingBudget = new Map<string, number>();
  const priorityRotationOrder: string[] = []; // franchise ids, in the order they won a free-period claim this pass
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

  // Rank every player's full candidate list (best to worst -- not just the top bid),
  // and give resolveWaiverAssignments each involved franchise's PRE-period roster/FAAB
  // baseline so it can decide, all at once, whose claims fit once each owner's own
  // priority order (not bid amount, not processing order) breaks any of their own
  // internal collisions -- with rejected claims cascading to the next candidate in
  // line for that specific player rather than going unclaimed.
  const waiverPriorityByFranchiseId = new Map(franchiseRows.map(row => [row.id, row.waiver_priority]));
  const rankedCandidatesByPlayer = new Map<string, WaiverCandidateBid[]>();
  for (const [playerId, bidsForPlayer] of Array.from(byPlayer.entries())) {
    const ranked = periodType === "free"
      ? selectFreeAgentCandidates(bidsForPlayer, waiverPriorityByFranchiseId).orderedCandidateFranchiseIds.map(franchiseId => bidsForPlayer.find(bid => bid.franchise_id === franchiseId)).filter((bid): bid is PendingBid => Boolean(bid))
      : rankBidPeriodCandidates<PendingBid>(bidsForPlayer, standings);
    rankedCandidatesByPlayer.set(playerId, ranked.map(bid => ({
      id: bid.id,
      franchiseId: bid.franchise_id,
      cost: periodType === "free" ? 1 : bid.amount,
      priority: bid.priority,
      maxPlayersDesired: bid.max_players_desired,
      dropPlayerId: bid.drop_player_id,
    })));
  }

  const involvedFranchiseIds = Array.from(new Set(pendingBids.map(bid => bid.franchise_id)));
  const capacityByFranchise = new Map<string, { rosterCount: number; budget: number }>();
  for (const franchiseId of involvedFranchiseIds) {
    capacityByFranchise.set(franchiseId, { rosterCount: await getRosterCount(franchiseId), budget: await getRemainingBudget(franchiseId) });
  }

  const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(rankedCandidatesByPlayer, capacityByFranchise, MAX_ROSTER_SIZE);

  for (const [playerId, bidsForPlayer] of orderedPlayers) {
    const playerName = playerById.get(playerId)?.display_name ?? "Unknown player";
    const winnerId = winnerByPlayer.get(playerId);
    const winner = winnerId ? bidsForPlayer.find(bid => bid.id === winnerId) ?? null : null;

    for (const bid of bidsForPlayer) {
      if (winner && bid.id === winner.id) continue;
      const rejection = rejectionReasonByBid.get(bid.id);
      if (rejection) {
        const franchiseName = franchiseById.get(bid.franchise_id)?.name ?? "Unknown franchise";
        const reason = rejection.type === "max_players_desired"
          ? `Already won ${rejection.limit} player${rejection.limit === 1 ? "" : "s"} this period, at their stated max of ${rejection.limit}.`
          : rejection.type === "budget"
          ? `Would cost $${rejection.cost} but they have only $${rejection.remaining} left this season.`
          : `Awarding this player would exceed the ${rejection.cap}-player CVC roster limit.`;
        skipped.push({ playerName, franchiseName, reason });
      }
      unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: now.toISOString() }).eq("id", bid.id).select("id").single());
    }
    if (!winner) continue;

    const franchise = franchiseById.get(winner.franchise_id);
    const awardAmount = periodType === "free" ? 1 : winner.amount;

    if (winner.drop_player_id) {
      unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now.toISOString() }).eq("season_id", seasonId).eq("franchise_id", winner.franchise_id).eq("player_id", winner.drop_player_id).is("released_at", null).select("id"));
      unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", seasonId).eq("franchise_id", winner.franchise_id).eq("player_id", winner.drop_player_id).select("id"));
    }

    unwrap(await supabase.from("roster_assignment").insert({ season_id: seasonId, franchise_id: winner.franchise_id, player_id: playerId, roster_state: "bench", acquired_via: periodType === "free" ? "waiver_free" : "waiver_bid", locked_until: nextResolutionAt.toISOString() }).select("id").single());
    unwrap(await supabase.from("player_contract").upsert({ season_id: seasonId, franchise_id: winner.franchise_id, player_id: playerId, salary: awardAmount, expires_year: seasonYear, source_marker: "W", contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
    unwrap(await supabase.from("faab_bid").update({ status: "won", resolved_at: now.toISOString() }).eq("id", winner.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: seasonId, franchise_id: winner.franchise_id, transaction_type: "waiver", status: "final", summary: `${franchise?.name ?? "A CVC franchise"} ${periodType === "free" ? "claimed" : "won"} ${playerName} for $${awardAmount}${periodType === "free" ? " (free agent period)" : " FAAB"} (${period.label}).`, details: { faab_bid_id: winner.id, player_id: playerId, amount: awardAmount } }).select("id").single());

    if (periodType === "free") priorityRotationOrder.push(winner.franchise_id);
    awarded.push({ playerName, franchiseName: franchise?.name ?? "Unknown franchise", amount: awardAmount, droppedPlayerName: winner.drop_player_id ? (playerById.get(winner.drop_player_id)?.display_name ?? null) : null });
  }

  // Free period only: move each winning franchise to the back of the waiver priority
  // line, in the order they won (so a franchise that won two claims this pass ends up
  // behind a franchise that won only one, matching standard "you used your turn"
  // waiver-priority rotation).
  if (priorityRotationOrder.length) {
    let backOfLine = Math.max(0, ...franchiseRows.map(row => row.waiver_priority ?? 0));
    const alreadyMoved = new Set<string>();
    for (const franchiseId of priorityRotationOrder) {
      if (alreadyMoved.has(franchiseId)) continue;
      alreadyMoved.add(franchiseId);
      backOfLine += 1;
      unwrap(await supabase.from("franchise").update({ waiver_priority: backOfLine }).eq("id", franchiseId).select("id").single());
    }
  }

  unwrap(await supabase.from("waiver_period").update({ status: "final" }).eq("id", period.id).select("id").single());
  const nextPeriodLabel = await createNextWaiverPeriod(seasonId, period.closes_at ? new Date(period.closes_at) : now, periodType);

  return { periodId: period.id, periodLabel: period.label, periodType, playersContested: byPlayer.size, awarded, skipped, nextPeriodLabel };
}
