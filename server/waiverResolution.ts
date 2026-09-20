import { supabase, unwrap } from "./supabase";
import { computeFranchiseStandings, getFaabBalance, MAX_ROSTER_SIZE, rankBidPeriodCandidates, resolveWaiverAssignments, selectFreeAgentCandidates, sortByWorstRecordFirst, type WaiverCandidateBid } from "./waiverRules";
import { computeNextResolutionTime, nextEasternWeekdayAt, sameEasternDayAt } from "./waiverResolutionTiming";

type PendingBid = { id: string; franchise_id: string; player_id: string; drop_player_id: string | null; amount: number; max_players_desired: number; priority: number; bid_group_id: string | null; confirmed_at: string | null };

// Every ungrouped ("default pool") bid shares this one sentinel group -- matches the
// original pre-grouping behavior exactly: one shared cap, off the bid's own
// max_players_desired column.
const DEFAULT_GROUP_KEY = "__default__";

export type ImmediateFreeAgentAwardResult =
  | { outcome: "awarded"; playerName: string; franchiseName: string }
  | { outcome: "already_claimed" }
  | { outcome: "rejected"; reason: string };

/**
 * Awards a single confirmed free-period claim the instant it's confirmed, instead of
 * leaving it "pending" until the whole period closes and resolveOpenWaiverPeriod's
 * batch cascade runs (commissioner call, Sept 2026: free-agent claims should process
 * immediately, any time during the 9am-1pm ET Sunday window -- not all at once at
 * 1pm). Mirrors the slice of resolveOpenWaiverPeriod's per-player award logic that
 * matters for a single claim (roster/contract/transaction inserts, waiver-priority
 * rotation), but there's no cascade to run: the first eligible confirm simply wins the
 * player, and it's rostered immediately, so every later claim on the same player fails
 * the ordinary "already rostered" check (in submitFaabBid, and again here as a
 * belt-and-suspenders re-check right before award, to close the race where two owners
 * confirm within moments of each other).
 *
 * resolveOpenWaiverPeriod still runs at period close as a cleanup pass -- it now
 * typically finds nothing left to do for a free period (everything either got awarded
 * here already or was never confirmed, and unconfirmed claims are excluded from
 * selectFreeAgentCandidates), but it still marks the period "final" and opens the next
 * one.
 */
export async function awardFreeAgentClaimNow(bidId: string): Promise<ImmediateFreeAgentAwardResult> {
  const bid = unwrap(await supabase.from("faab_bid").select("id, franchise_id, player_id, drop_player_id, bid_group_id, waiver_period_id, status").eq("id", bidId).maybeSingle());
  if (!bid || bid.status !== "pending") return { outcome: "rejected", reason: "That claim is no longer pending." };

  const [periodResult, playerResult, franchiseResult, alreadyRosteredResult] = await Promise.all([
    supabase.from("waiver_period").select("id, season_id, label, closes_at, period_type, status").eq("id", bid.waiver_period_id).single(),
    supabase.from("player").select("id, display_name").eq("id", bid.player_id).single(),
    supabase.from("franchise").select("id, name").eq("id", bid.franchise_id).single(),
    supabase.from("roster_assignment").select("id").eq("player_id", bid.player_id).is("released_at", null).limit(1).maybeSingle(),
  ]);
  const period = unwrap(periodResult);
  const player = unwrap(playerResult);
  const franchise = unwrap(franchiseResult);
  if (!period || !player || !franchise) return { outcome: "rejected", reason: "Claim details could not be loaded." };

  if (unwrap(alreadyRosteredResult)) {
    unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: new Date().toISOString() }).eq("id", bidId).select("id").single());
    return { outcome: "already_claimed" };
  }

  await ensureWaiverPriorityBootstrapped(period.season_id);

  // Same shared-pool cap the batch resolver enforces: an ungrouped claim's limit is
  // the franchise's current default-pool max (the highest max_players_desired among
  // its still-pending ungrouped claims this period, so a later-raised max always
  // wins); a grouped claim shares its own group's stated max instead.
  let capLimit = 1;
  let groupLabel: string | null = null;
  if (bid.bid_group_id) {
    const group = unwrap(await supabase.from("faab_bid_group").select("id, label, max_players_desired").eq("id", bid.bid_group_id).maybeSingle());
    capLimit = group?.max_players_desired ?? 1;
    groupLabel = group?.label ?? null;
  } else {
    const poolBids = unwrap(await supabase.from("faab_bid").select("max_players_desired").eq("waiver_period_id", period.id).eq("franchise_id", bid.franchise_id).eq("status", "pending").is("bid_group_id", null)) ?? [];
    capLimit = poolBids.length ? Math.max(...poolBids.map(row => row.max_players_desired)) : 1;
  }
  let wonQuery = supabase.from("faab_bid").select("id", { count: "exact", head: true }).eq("waiver_period_id", period.id).eq("franchise_id", bid.franchise_id).eq("status", "won");
  wonQuery = bid.bid_group_id ? wonQuery.eq("bid_group_id", bid.bid_group_id) : wonQuery.is("bid_group_id", null);
  const wonSoFar = (await wonQuery).count ?? 0;
  if (wonSoFar >= capLimit) {
    return { outcome: "rejected", reason: `Already claimed ${wonSoFar} player${wonSoFar === 1 ? "" : "s"}${groupLabel ? ` in the "${groupLabel}" group` : ""} this period, at your stated max of ${capLimit}.` };
  }

  const balance = await getFaabBalance(bid.franchise_id, period.season_id);
  if (balance < 1) {
    return { outcome: "rejected", reason: `This claim exceeds your remaining CVC FAAB budget. You have $${balance} left this season.` };
  }

  const now = new Date().toISOString();
  const seasonYear = unwrap(await supabase.from("season").select("year").eq("id", period.season_id).single())?.year ?? new Date().getFullYear();

  // The roster insert goes FIRST, before the drop is released. The alreadyRostered
  // check above is a read, so it cannot by itself stop two owners who confirm within
  // the same moment -- only the partial unique index added in migration
  // 202609200001 (season_id, player_id) where released_at is null actually
  // serialises that, and it does so by failing this insert. Releasing the dropped
  // player first would mean a loser of that race gives up a player and gets nothing
  // back, so nothing destructive happens until the contended insert has succeeded.
  //
  // Locked until this free period closes rather than until "the next resolution" --
  // now that awards happen the moment they're confirmed instead of all at once at
  // close, "the next resolution" would otherwise mean nothing changed and a player
  // claimed at 9:05am could be cut and re-claimed by someone else at 9:06am.
  const rosterInsert = await supabase.from("roster_assignment").insert({ season_id: period.season_id, franchise_id: bid.franchise_id, player_id: bid.player_id, roster_state: "bench", acquired_via: "waiver_free", locked_until: period.closes_at }).select("id").single();
  if (rosterInsert.error) {
    // 23505 = unique_violation: someone else's confirm landed in the moments since the
    // read above. Same outcome as losing the pre-check, and no drop has happened yet.
    if (rosterInsert.error.code === "23505") {
      unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: now }).eq("id", bidId).select("id").single());
      return { outcome: "already_claimed" };
    }
    throw new Error(rosterInsert.error.message);
  }

  if (bid.drop_player_id) {
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now }).eq("season_id", period.season_id).eq("franchise_id", bid.franchise_id).eq("player_id", bid.drop_player_id).is("released_at", null).select("id"));
    unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", period.season_id).eq("franchise_id", bid.franchise_id).eq("player_id", bid.drop_player_id).select("id"));
  }

  unwrap(await supabase.from("player_contract").upsert({ season_id: period.season_id, franchise_id: bid.franchise_id, player_id: bid.player_id, salary: 1, expires_year: seasonYear, source_marker: "W", contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
  unwrap(await supabase.from("faab_bid").update({ status: "won", resolved_at: now, confirmed_at: now }).eq("id", bidId).select("id").single());
  unwrap(await supabase.from("transaction").insert({ season_id: period.season_id, franchise_id: bid.franchise_id, transaction_type: "waiver", status: "final", summary: `${franchise.name} claimed ${player.display_name} for $1 (free agent period).`, details: { faab_bid_id: bidId, player_id: bid.player_id, amount: 1 } }).select("id").single());

  // Move this franchise to the back of the waiver-priority line -- same rotation the
  // batch resolver did for every winner at once, just applied the instant each claim
  // wins instead.
  const franchises = unwrap(await supabase.from("franchise").select("id, waiver_priority").eq("is_active", true)) ?? [];
  const backOfLine = Math.max(0, ...franchises.map(row => row.waiver_priority ?? 0)) + 1;
  unwrap(await supabase.from("franchise").update({ waiver_priority: backOfLine }).eq("id", bid.franchise_id).select("id").single());

  return { outcome: "awarded", playerName: player.display_name, franchiseName: franchise.name };
}

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
  const pendingBids = (unwrap(await supabase.from("faab_bid").select("id, franchise_id, player_id, drop_player_id, amount, max_players_desired, priority, bid_group_id, confirmed_at").eq("waiver_period_id", period.id).eq("status", "pending")) ?? []) as PendingBid[];

  if (periodType === "free" && pendingBids.length) await ensureWaiverPriorityBootstrapped(seasonId);

  const involvedPlayerIds = pendingBids.length ? Array.from(new Set(pendingBids.map(bid => bid.player_id))) : ["00000000-0000-0000-0000-000000000000"];
  const involvedGroupIds = Array.from(new Set(pendingBids.map(bid => bid.bid_group_id).filter((id): id is string => Boolean(id))));
  const [franchisesResult, playersResult, seasonResult, standings, groupsResult] = await Promise.all([
    supabase.from("franchise").select("id, name, waiver_priority").eq("is_active", true),
    supabase.from("player").select("id, display_name").in("id", involvedPlayerIds),
    supabase.from("season").select("year").eq("id", seasonId).single(),
    computeFranchiseStandings(seasonId),
    involvedGroupIds.length ? supabase.from("faab_bid_group").select("id, label, max_players_desired").in("id", involvedGroupIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const franchiseRows = unwrap(franchisesResult) ?? [];
  const franchiseById = new Map(franchiseRows.map(row => [row.id, row]));
  const playerById = new Map((unwrap(playersResult) ?? []).map(row => [row.id, row]));
  const seasonYear = unwrap(seasonResult)?.year ?? new Date().getFullYear();
  const groupById = new Map((unwrap(groupsResult as { data: { id: string; label: string; max_players_desired: number }[] | null; error: { message: string } | null }) ?? []).map(row => [row.id, row]));
  // The default pool's max_players_desired is a per-franchise value the UI treats as
  // shared (the highest value among an owner's ungrouped pending bids -- see
  // setFaabBidGroupMaxPlayers), but it's still stored per individual bid row, so a bid
  // added -- or moved back into the pool -- after the owner last raised the pool's max
  // can carry a stale value. Recompute the true current pool max per franchise here so
  // resolution always matches what the UI shows, regardless of what's stored on any
  // one bid.
  const defaultPoolMaxByFranchise = new Map<string, number>();
  for (const bid of pendingBids) {
    if (bid.bid_group_id) continue;
    defaultPoolMaxByFranchise.set(bid.franchise_id, Math.max(defaultPoolMaxByFranchise.get(bid.franchise_id) ?? 1, bid.max_players_desired));
  }

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
    // A claim in an owner-defined group shares that group's own max_players_desired
    // cap with every other claim in it; an ungrouped claim shares the one default-pool
    // cap (its own max_players_desired column), exactly like before any grouping
    // feature existed.
    rankedCandidatesByPlayer.set(playerId, ranked.map(bid => {
      const group = bid.bid_group_id ? groupById.get(bid.bid_group_id) : null;
      const maxPlayersDesired = group ? group.max_players_desired : (defaultPoolMaxByFranchise.get(bid.franchise_id) ?? bid.max_players_desired);
      return {
        id: bid.id,
        franchiseId: bid.franchise_id,
        cost: periodType === "free" ? 1 : bid.amount,
        priority: bid.priority,
        maxPlayersDesired,
        dropPlayerId: bid.drop_player_id,
        groupKey: bid.bid_group_id ?? DEFAULT_GROUP_KEY,
      };
    }));
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
          ? `Already won ${rejection.limit} player${rejection.limit === 1 ? "" : "s"}${bid.bid_group_id ? ` in their "${groupById.get(bid.bid_group_id)?.label ?? "custom"}" group` : ""} this period, at their stated max of ${rejection.limit}.`
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
