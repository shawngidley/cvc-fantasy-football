import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getFantasyProsDataAdapter, getNFLDataAdapter, Tank01NFLDataAdapter } from "../nflDataAdapter";
import { getCvcPlayerCareerStats, parseCvcGameLog } from "../playerCareerStats";
import { fantasyProsCacheStatus, getFantasyProsActivePlayerIds, getFantasyProsRookiePlayerIds } from "../fantasyProsCache";
import { getFantasyProsInjuries, getFantasyProsNews, getFantasyProsProjections, getFantasyProsRanks } from "../fantasyProsNews";
import { normalizePlayerName } from "@shared/playerNameMatch";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";
import { getFaabBalance, MAX_ROSTER_SIZE, STARTING_FAAB } from "../waiverRules";
import { resolveOpenWaiverPeriod } from "../waiverResolution";
import { computeNextResolutionTime } from "../waiverResolutionTiming";
import { syncFantasyProsSnapshot, syncFantasyProsActiveFlags, syncFantasyProsRookieFlags } from "../fantasyProsSync";
import { syncTank01SeasonStats } from "../tank01SeasonStatsSync";
import { syncTank01ActiveRoster } from "../tank01ActiveRosterSync";
import { LOTTERY_REVEAL_INTERVAL_SECONDS, lotteryCommitment, revealedLotteryCount, reverseLotteryPositions, secureShuffle } from "../rookieDraftLottery";
import { activeLiveLineup } from "../liveScoringLineup";
import { supabase, unwrap } from "../supabase";
import { cvcContractTier, cvcFranchiseTerms, cvcPriorSeasonSalary, cvcTransitionSalary, isCvcHighSalaryTransition, isCvcProtectionYear } from "../../shared/cvcProtectionPolicy";

type CurrentUser = { openId: string };

export const matchupInputSchema = z.object({
  weekNumber: z.number().int().min(1).max(30),
  homeFranchiseId: z.string().uuid(),
  awayFranchiseId: z.string().uuid(),
  resultState: z.enum(["upcoming", "live", "final", "corrected"]),
}).refine(value => value.homeFranchiseId !== value.awayFranchiseId, { message: "A franchise cannot play itself." });

async function getOwnerAccess(user: CurrentUser) {
  const cvcOwnerId = user.openId.startsWith("cvc:") ? user.openId.slice(4) : null;
  if (cvcOwnerId) {
    return unwrap(await supabase
      .from("owner")
      .select("id, league_id, display_name, role")
      .eq("id", cvcOwnerId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle());
  }
  const owner = unwrap(await supabase
    .from("owner")
    .select("id, league_id, display_name, role")
    .eq("user_open_id", user.openId)
    .limit(1)
    .maybeSingle());
  return owner;
}

async function requireCommissioner(user: CurrentUser) {
  const owner = await getOwnerAccess(user);
  if (!owner || !["commissioner", "administrator"].includes(owner.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Commissioner access is required for this CVC operation." });
  }
  return owner;
}

async function getCurrentLeagueAndSeason() {
  const league = unwrap(await supabase.from("league").select("id").eq("slug", "cvc-auction-football").single());
  if (!league) throw new TRPCError({ code: "NOT_FOUND", message: "CVC league configuration was not found." });
  // Prefer the explicitly-flagged current season (see is_current migration) -- neither
  // `year` nor `status` can safely identify it once a future season row exists (e.g. to
  // hold next year's tradeable rookie picks) or if status drifts out of sync, which it
  // has. Falls back to the old highest-year behavior only if no season is flagged yet.
  const flagged = unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).eq("is_current", true).limit(1).maybeSingle());
  const season = flagged ?? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season configuration was not found." });
  return { league, season };
}

async function createAuditEvent(leagueId: string, seasonId: string, actorOwnerId: string, entityType: string, entityId: string | null, action: string, summary: string) {
  unwrap(await supabase.from("audit_event").insert({ league_id: leagueId, season_id: seasonId, actor_owner_id: actorOwnerId, entity_type: entityType, entity_id: entityId, action, summary }).select("id").single());
}

/** Moves every player/pick asset in an accepted trade to its new owner and marks the
 * trade 'processed'. Extracted so respondToTrade can execute a trade the instant the
 * recipient accepts (no separate commissioner-approval step), while executeTrade stays
 * available as a manual backup/re-run tool for edge cases using the exact same logic. */
async function executeAcceptedTrade(tradeId: string, season: { id: string; year: number }, actorOwnerId: string, auditSummary: string) {
  const { league } = await getCurrentLeagueAndSeason();
  const trade = unwrap(await supabase.from("trade_offer").select("id, proposer_franchise_id, recipient_franchise_id, status, proposer:proposer_franchise_id(name), recipient:recipient_franchise_id(name), assets:trade_asset(id, from_franchise_id, player_id, draft_pick_id)").eq("id", tradeId).eq("season_id", season.id).maybeSingle());
  if (!trade || trade.status !== "accepted") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an accepted CVC trade may be executed." });
  const assets = trade.assets ?? [];
  const playerAssets = assets.filter((asset: any) => asset.player_id);
  const pickAssets = assets.filter((asset: any) => asset.draft_pick_id);
  const [assignments, picks] = await Promise.all([
    playerAssets.length ? supabase.from("roster_assignment").select("id, player_id, franchise_id").eq("season_id", season.id).in("player_id", playerAssets.map((asset: any) => asset.player_id)).is("released_at", null) : Promise.resolve({ data: [] }),
    pickAssets.length ? supabase.from("draft_pick").select("id, current_franchise_id, pick_status").in("id", pickAssets.map((asset: any) => asset.draft_pick_id)) : Promise.resolve({ data: [] }),
  ]);
  const assignmentByPlayer = new Map((assignments.data ?? []).map((assignment: any) => [assignment.player_id, assignment]));
  const pickById = new Map((picks.data ?? []).map((pick: any) => [pick.id, pick]));
  if (playerAssets.some((asset: any) => assignmentByPlayer.get(asset.player_id)?.franchise_id !== asset.from_franchise_id)) throw new TRPCError({ code: "CONFLICT", message: "A CVC trade player is no longer on its offering franchise roster." });
  if (pickAssets.some((asset: any) => pickById.get(asset.draft_pick_id)?.current_franchise_id !== asset.from_franchise_id || pickById.get(asset.draft_pick_id)?.pick_status !== "open")) throw new TRPCError({ code: "CONFLICT", message: "A CVC trade draft pick is no longer owned by its offering franchise, or has already been selected." });
  await Promise.all([
    ...playerAssets.map(async (asset: any) => {
      const destination = asset.from_franchise_id === trade.proposer_franchise_id ? trade.recipient_franchise_id : trade.proposer_franchise_id;
      await Promise.all([
        supabase.from("roster_assignment").update({ franchise_id: destination, roster_state: "active", updated_at: new Date().toISOString() }).eq("id", assignmentByPlayer.get(asset.player_id)!.id).select("id"),
        supabase.from("player_contract").update({ franchise_id: destination }).eq("season_id", season.id).eq("franchise_id", asset.from_franchise_id).eq("player_id", asset.player_id).select("id"),
        supabase.from("player_right").update({ status: "expired" }).eq("season_id", season.id).eq("franchise_id", asset.from_franchise_id).eq("player_id", asset.player_id).in("right_type", ["franchise", "transition"]).eq("status", "active").select("id"),
      ]);
    }),
    ...pickAssets.map(async (asset: any) => {
      const destination = asset.from_franchise_id === trade.proposer_franchise_id ? trade.recipient_franchise_id : trade.proposer_franchise_id;
      await supabase.from("draft_pick").update({ current_franchise_id: destination }).eq("id", asset.draft_pick_id).select("id");
    }),
  ]);
  unwrap(await supabase.from("trade_offer").update({ status: "processed", reviewed_at: new Date().toISOString(), reviewed_by_owner_id: actorOwnerId }).eq("id", trade.id).select("id").single());
  unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: trade.proposer_franchise_id, actor_owner_id: actorOwnerId, transaction_type: "trade", status: "final", summary: `${trade.proposer?.[0]?.name ?? "CVC franchise"} completed a trade with ${trade.recipient?.[0]?.name ?? "CVC franchise"}.`, details: { trade_offer_id: trade.id, asset_count: assets.length } }).select("id").single());
  await createAuditEvent(league.id, season.id, actorOwnerId, "trade_offer", trade.id, "processed", auditSummary);
}

// Applies a completed lottery's drawn franchise order onto the round's actual
// draft_pick rows: franchiseOrder[0] (revealed first, draft_position N) goes to the
// LAST pick of the round; franchiseOrder[N-1] (revealed last, draft_position 1) goes
// to the FIRST pick — matching reverseLotteryPositions' reveal-order mapping exactly.
// Runs the individual pick updates in parallel (not a sequential awaited loop) to
// minimize the chance of a slow request timing out partway through, and marks
// results_applied so a future request can detect and retry if it ever does fail
// partway anyway — this used to be a single unretried attempt with no way to notice
// or recover from a partial failure.
async function applyRookieLotteryResults(lotteryId: string, draftId: string, roundNumber: number, franchiseOrder: string[]) {
  const picks = unwrap(await supabase.from("draft_pick").select("id, pick_number").eq("draft_id", draftId).eq("round_number", roundNumber).order("pick_number")) ?? [];
  const count = franchiseOrder.length;
  const updates = Array.from({ length: count }, (_, index) => {
    const draftPosition = count - index;
    const pick = picks[draftPosition - 1];
    const franchiseId = franchiseOrder[index];
    return pick ? { pick, franchiseId } : null;
  }).filter((item): item is { pick: { id: string; pick_number: number }; franchiseId: string } => item !== null);
  // draft_pick has no updated_at column (only created_at) -- including one here
  // caused every write to be rejected by PostgREST with "Could not find the
  // 'updated_at' column of 'draft_pick' in the schema cache", so this apply
  // step failed 100% of the time and the lottery's results never landed.
  await Promise.all(updates.map(({ pick, franchiseId }) => supabase.from("draft_pick").update({ original_franchise_id: franchiseId, current_franchise_id: franchiseId }).eq("id", pick.id).select("id").single().then(unwrap)));
  unwrap(await supabase.from("rookie_draft_lottery").update({ results_applied: true, updated_at: new Date().toISOString() }).eq("id", lotteryId).select("id").single());
}

/** Attaches cached Tank01 season-total stats (see tank01SeasonStatsSync.ts) to a page
 * of player rows for display — a cheap join against the cache table, never a live
 * per-row Tank01 call. Players with no cached row yet (not synced) are left as-is. */
async function attachSeasonStats<T extends { id: string }>(players: T[], seasonId: string): Promise<(T & { seasonStats?: Record<string, number | null> })[]> {
  if (!players.length) return players;
  const rows = unwrap(await supabase.from("player_season_stat").select("player_id, games_played, pass_yds, pass_td, pass_int, rush_att, rush_yds, rush_td, targets, receptions, rec_yds, rec_td, fg_made, xp_made, sacks, def_int, def_td, fantasy_points, fantasy_points_per_game").eq("season_id", seasonId).in("player_id", players.map(player => player.id))) ?? [];
  const byPlayerId = new Map(rows.map(row => [row.player_id, row]));
  return players.map(player => {
    const stats = byPlayerId.get(player.id);
    return stats ? { ...player, seasonStats: stats } : player;
  });
}

export const leagueRouter = router({
  overview: publicProcedure.query(async () => {
    const [league, seasonFlagged, franchises, owners, weeks, matchups, financialEntries] = await Promise.all([
      supabase.from("league").select("id, slug, name, short_name, timezone, primary_color, accent_color").eq("slug", "cvc-auction-football").single(),
      supabase.from("season").select("id, year, label, status, regular_season_weeks, playoff_teams").eq("is_current", true).limit(1).maybeSingle(),
      supabase.from("franchise").select("id, name, abbreviation, division_name, current_owner_id, brand_color, logo_url, display_order").eq("is_active", true).order("display_order"),
      supabase.from("owner").select("id, display_name, role").eq("is_active", true),
      supabase.from("schedule_week").select("id, week_number, label, status").order("week_number"),
      supabase.from("matchup").select("id, schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, home_projection, away_projection, result_state").order("created_at"),
      supabase.from("league_financial_entry").select("franchise_id, entry_type, amount, status").order("created_at"),
    ]);

    const leagueData = unwrap(league);
    const seasonData = unwrap(seasonFlagged) ?? unwrap(await supabase.from("season").select("id, year, label, status, regular_season_weeks, playoff_teams").order("year", { ascending: false }).limit(1).maybeSingle());
    const franchiseRows = unwrap(franchises) ?? [];
    const ownerRows = unwrap(owners) ?? [];
    const weekRows = unwrap(weeks) ?? [];
    const matchupRows = unwrap(matchups) ?? [];
    const financialRows = unwrap(financialEntries) ?? [];
    const ownerById = new Map(ownerRows.map(owner => [owner.id, owner]));
    const teamById = new Map(franchiseRows.map(franchise => [franchise.id, franchise]));
    const weekById = new Map(weekRows.map(week => [week.id, week]));

    const franchiseStats = new Map(franchiseRows.map(franchise => [franchise.id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, divisionWins: 0, divisionLosses: 0 }]));
    matchupRows.filter(matchup => matchup.result_state === "final").forEach(matchup => {
      const home = franchiseStats.get(matchup.home_franchise_id); const away = franchiseStats.get(matchup.away_franchise_id);
      if (!home || !away) return;
      const homeScore = Number(matchup.home_score); const awayScore = Number(matchup.away_score); const sameDivision = teamById.get(matchup.home_franchise_id)?.division_name === teamById.get(matchup.away_franchise_id)?.division_name;
      home.pointsFor += homeScore; home.pointsAgainst += awayScore; away.pointsFor += awayScore; away.pointsAgainst += homeScore;
      if (homeScore > awayScore) { home.wins += 1; away.losses += 1; if (sameDivision) { home.divisionWins += 1; away.divisionLosses += 1; } }
      if (awayScore > homeScore) { away.wins += 1; home.losses += 1; if (sameDivision) { away.divisionWins += 1; home.divisionLosses += 1; } }
    });
    const divisionLeaders = new Map<string, { wins: number; losses: number }>();
    franchiseRows.forEach(franchise => { const stats = franchiseStats.get(franchise.id)!; const key = franchise.division_name ?? "Unassigned"; const leader = divisionLeaders.get(key); if (!leader || stats.wins > leader.wins || (stats.wins === leader.wins && stats.losses < leader.losses)) divisionLeaders.set(key, stats); });
    const franchisesWithRecord = franchiseRows.map(franchise => {
      const completed = matchupRows.filter(matchup => matchup.result_state === "final" && (matchup.home_franchise_id === franchise.id || matchup.away_franchise_id === franchise.id));
      const stats = franchiseStats.get(franchise.id)!;
      const leader = divisionLeaders.get(franchise.division_name ?? "Unassigned")!;
      const moneyOwed = financialRows.filter(entry => entry.franchise_id === franchise.id && entry.status === "open").reduce((total, entry) => total + Number(entry.amount) * (["credit", "payout"].includes(entry.entry_type) ? -1 : 1), 0);
      return {
        ...franchise,
        owner: franchise.current_owner_id ? ownerById.get(franchise.current_owner_id)?.display_name ?? "Unassigned" : "Unassigned",
        record: `${stats.wins}–${stats.losses}`,
        wins: stats.wins,
        losses: stats.losses,
        gamesBack: Number((((leader.wins - stats.wins) + (stats.losses - leader.losses)) / 2).toFixed(1)),
        pointsFor: stats.pointsFor,
        pointsAgainst: stats.pointsAgainst,
        divisionRecord: `${stats.divisionWins}–${stats.divisionLosses}`,
        moneyOwed,
        completedGames: completed.length,
      };
    }).sort((left, right) => left.division_name.localeCompare(right.division_name) || right.wins - left.wins || left.losses - right.losses || right.pointsFor - left.pointsFor || left.display_order - right.display_order);

    return {
      league: leagueData,
      season: seasonData,
      franchises: franchisesWithRecord,
      matchups: matchupRows.map(matchup => ({
        ...matchup,
        week: weekById.get(matchup.schedule_week_id),
        home: teamById.get(matchup.home_franchise_id)?.name ?? "TBD",
        away: teamById.get(matchup.away_franchise_id)?.name ?? "TBD",
        homeLogoUrl: teamById.get(matchup.home_franchise_id)?.logo_url ?? null,
        awayLogoUrl: teamById.get(matchup.away_franchise_id)?.logo_url ?? null,
        homeAbbreviation: teamById.get(matchup.home_franchise_id)?.abbreviation ?? null,
        awayAbbreviation: teamById.get(matchup.away_franchise_id)?.abbreviation ?? null,
      })),
    };
  }),

  setupSummary: publicProcedure.query(async () => {
    const tableNames = ["league", "season", "franchise", "owner", "roster_slot", "scoring_rule", "schedule_week", "matchup", "player", "roster_assignment", "transaction", "draft", "draft_pick", "waiver_period", "faab_bid", "rule_document", "league_financial_entry"];
    const [league, season, owners, franchises, slots, scoring, weeks, matchups, players, assignments, transactions, drafts, picks, waivers, bids, rules, financialEntries] = await Promise.all([
      supabase.from("league").select("id", { count: "exact", head: true }),
      supabase.from("season").select("id", { count: "exact", head: true }),
      supabase.from("owner").select("id", { count: "exact", head: true }),
      supabase.from("franchise").select("id", { count: "exact", head: true }),
      supabase.from("roster_slot").select("id", { count: "exact", head: true }),
      supabase.from("scoring_rule").select("id", { count: "exact", head: true }),
      supabase.from("schedule_week").select("id", { count: "exact", head: true }),
      supabase.from("matchup").select("id", { count: "exact", head: true }),
      supabase.from("player").select("id", { count: "exact", head: true }),
      supabase.from("roster_assignment").select("id", { count: "exact", head: true }),
      supabase.from("transaction").select("id", { count: "exact", head: true }),
      supabase.from("draft").select("id", { count: "exact", head: true }),
      supabase.from("draft_pick").select("id", { count: "exact", head: true }),
      supabase.from("waiver_period").select("id", { count: "exact", head: true }),
      supabase.from("faab_bid").select("id", { count: "exact", head: true }),
      supabase.from("rule_document").select("id", { count: "exact", head: true }),
      supabase.from("league_financial_entry").select("id", { count: "exact", head: true }),
    ]);
    const results = [league, season, franchises, owners, slots, scoring, weeks, matchups, players, assignments, transactions, drafts, picks, waivers, bids, rules, financialEntries];
    results.forEach(result => unwrap(result));
    return tableNames.map((table, index) => ({ table, count: results[index]?.count ?? 0 }));
  }),

  activity: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    // Only trade/add/drop/waiver rows are ever eligible for the public board (see filter
    // below), so restrict the raw fetch to those types before limiting — otherwise a
    // burst of same-day admin activity (protection notes, commissioner adjustments,
    // draft picks, etc.) can fill the row-limit window and push a genuinely recent
    // trade or pickup/drop out of view even though it still qualifies for display.
    const [txResult, draftsResult] = await Promise.all([
      supabase.from("transaction").select("id, transaction_type, status, summary, occurred_at, details, franchise_id, franchise:franchise_id(name, is_active)").eq("season_id", season.id).in("transaction_type", ["trade", "add", "drop", "waiver"]).order("occurred_at", { ascending: false }).limit(200),
      supabase.from("draft").select("status").eq("season_id", season.id),
    ]);
    const { data, error } = txResult;
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    const drafts = unwrap(draftsResult) ?? [];
    // The public board only ever surfaces pickups, drops, and trades — nothing else (protection
    // notes, lineup moves, draft picks, commissioner adjustments, etc. stay off it entirely).
    // Pickups/drops are further held back until every configured draft (rookie + auction) for the
    // season is marked complete; trades are always visible.
    const draftsConcluded = drafts.length > 0 && drafts.every(draft => draft.status === "complete");
    const pickupOrDropTypes = ["add", "drop", "waiver"];
    const legacySummary = /atlas aces|harbor hounds|placeholder/i;
    return (data ?? []).filter((item: any) => {
      const franchise = Array.isArray(item.franchise) ? item.franchise[0] : item.franchise;
      if (franchise?.is_active === false || legacySummary.test(item.summary ?? "")) return false;
      if (item.transaction_type === "trade") return true;
      if (!pickupOrDropTypes.includes(item.transaction_type)) return false;
      return draftsConcluded;
    }).slice(0, 50).map((item: any) => {
      const franchise = Array.isArray(item.franchise) ? item.franchise[0] : item.franchise;
      return { ...item, franchise_name: franchise?.name ?? null };
    });
  }),

  auditHistory: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional()).query(async ({ ctx, input }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    return unwrap(await supabase.from("audit_event").select("id, entity_type, entity_id, action, summary, created_at, actor:actor_owner_id(display_name, role)").eq("season_id", season.id).order("created_at", { ascending: false }).limit(input?.limit ?? 100)) ?? [];
  }),

  draftBoard: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    const { data: draft, error: draftError } = await supabase.from("draft").select("id, label, draft_type, status, pick_timer_seconds, keeper_enabled, lottery_enabled, settings").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle();
    if (draftError || !draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC draft configuration was not found." });
    const [picksResult, franchisesResult] = await Promise.all([
      supabase.from("draft_pick").select("id, round_number, pick_number, original_franchise_id, current_franchise_id, player_id, pick_status, is_protected, notes").eq("draft_id", draft.id).order("pick_number").limit(500),
      supabase.from("franchise").select("id, name, abbreviation, logo_url").eq("is_active", true).limit(100),
    ]);
    const picks = unwrap(picksResult) ?? [];
    const franchises = unwrap(franchisesResult) ?? [];
    const franchiseById = new Map(franchises.map(franchise => [franchise.id, franchise]));
    // A pick's franchise (original/current) tracks who HELD the pick, which can differ
    // from who actually WON the player (the pick holder nominates live in the room but
    // can lose the match to a higher bidder — see recordDraftSelection). The winning
    // franchise and salary only exist on player_contract, not on draft_pick itself.
    const selectedPlayerIds = picks.map(pick => pick.player_id).filter((id): id is string => Boolean(id));
    const [playersResult, contractsResult] = selectedPlayerIds.length ? await Promise.all([
      supabase.from("player").select("id, display_name, position, nfl_team").in("id", selectedPlayerIds),
      supabase.from("player_contract").select("player_id, franchise_id, salary").eq("season_id", season.id).eq("contract_status", "active").in("player_id", selectedPlayerIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const playerById = new Map((unwrap(playersResult) ?? []).map(player => [player.id, player]));
    const contractByPlayerId = new Map((unwrap(contractsResult) ?? []).map(contract => [contract.player_id, contract]));
    return { ...draft, picks: picks.map(pick => {
      const player = pick.player_id ? playerById.get(pick.player_id) : null;
      const contract = pick.player_id ? contractByPlayerId.get(pick.player_id) : null;
      return {
        ...pick,
        originalFranchise: franchiseById.get(pick.original_franchise_id)?.name ?? "Unknown",
        currentFranchise: franchiseById.get(pick.current_franchise_id)?.name ?? "Unknown",
        playerName: player?.display_name ?? null,
        playerNflTeam: player?.nfl_team ?? null,
        winningFranchise: contract ? franchiseById.get(contract.franchise_id)?.name ?? "Unknown" : null,
        salary: contract ? Number(contract.salary) : null,
      };
    }) };
  }),

  rookieLottery: publicProcedure.input(z.object({ roundNumber: z.number().int().min(1).max(20).optional() }).optional()).query(async ({ input }) => {
    const roundNumber = input?.roundNumber ?? 2;
    const { season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle());
    if (!draft) return null;
    const lottery = unwrap(await supabase.from("rookie_draft_lottery").select("id, status, franchise_count, order_commitment, reveal_interval_seconds, revealed_count, started_at, elapsed_ms_before_pause, paused_at, completed_at, aborted_at, abort_reason, results_applied").eq("draft_id", draft.id).eq("round_number", roundNumber).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (!lottery) return null;

    let revealedCount = lottery.revealed_count;
    let status = lottery.status;
    if (lottery.status === "RUNNING") {
      const computed = revealedLotteryCount({ franchiseCount: lottery.franchise_count, revealIntervalSeconds: lottery.reveal_interval_seconds, revealedCount: lottery.revealed_count, elapsedMsBeforePause: Number(lottery.elapsed_ms_before_pause), startedAt: lottery.started_at, status: lottery.status });
      if (computed > lottery.revealed_count) {
        // franchise_order is only ever fetched inside this handler, never returned to
        // the client — the public payload below carries just the commitment hash and
        // whatever's already been individually revealed.
        const full = unwrap(await supabase.from("rookie_draft_lottery").select("franchise_order").eq("id", lottery.id).single());
        const positions = reverseLotteryPositions(full?.franchise_order ?? [], computed).slice(lottery.revealed_count);
        if (positions.length) unwrap(await supabase.from("rookie_draft_lottery_reveal").upsert(positions.map(p => ({ lottery_id: lottery.id, reveal_index: p.revealIndex, draft_position: p.draftPosition, franchise_id: p.franchiseId })), { onConflict: "lottery_id,reveal_index", ignoreDuplicates: true }).select("id"));
        revealedCount = computed;
        const isComplete = computed >= lottery.franchise_count;
        if (isComplete) {
          // Compare-and-swap on status='RUNNING' so only one concurrent poller (many
          // owners can be watching the reveal live) wins the RUNNING->COMPLETE
          // transition — but ALWAYS attempts applyRookieLotteryResults below via the
          // results_applied self-heal check, whether or not this particular request
          // won the swap, so a request that dies partway through the pick writes
          // still gets retried by the next one instead of leaving it stuck forever.
          unwrap(await supabase.from("rookie_draft_lottery").update({ revealed_count: computed, status: "COMPLETE", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", lottery.id).eq("status", "RUNNING").select("id").maybeSingle());
          status = "COMPLETE";
          if (!lottery.results_applied) await applyRookieLotteryResults(lottery.id, draft.id, roundNumber, full?.franchise_order ?? []);
        } else {
          unwrap(await supabase.from("rookie_draft_lottery").update({ revealed_count: computed, updated_at: new Date().toISOString() }).eq("id", lottery.id).select("id").single());
        }
      }
    } else if (lottery.status === "COMPLETE" && !lottery.results_applied) {
      // Self-heals a lottery that reached COMPLETE in an earlier request but never
      // successfully finished writing draft_pick (e.g. that request timed out
      // partway through the pick updates) — every request that observes this now
      // retries the write until results_applied is confirmed set.
      const full = unwrap(await supabase.from("rookie_draft_lottery").select("franchise_order").eq("id", lottery.id).single());
      await applyRookieLotteryResults(lottery.id, draft.id, roundNumber, full?.franchise_order ?? []);
    }

    const revealRows = unwrap(await supabase.from("rookie_draft_lottery_reveal").select("reveal_index, draft_position, revealed_at, franchise:franchise_id(name, logo_url)").eq("lottery_id", lottery.id).order("reveal_index")) ?? [];
    return {
      id: lottery.id,
      status,
      franchiseCount: lottery.franchise_count,
      orderCommitment: lottery.order_commitment,
      revealIntervalSeconds: lottery.reveal_interval_seconds,
      revealedCount,
      startedAt: lottery.started_at,
      elapsedMsBeforePause: Number(lottery.elapsed_ms_before_pause),
      pausedAt: lottery.paused_at,
      completedAt: lottery.completed_at,
      abortReason: lottery.abort_reason,
      reveals: revealRows.map((row: any) => { const franchise = Array.isArray(row.franchise) ? row.franchise[0] : row.franchise; return { revealIndex: row.reveal_index, draftPosition: row.draft_position, revealedAt: row.revealed_at, franchiseName: franchise?.name ?? "Unknown", franchiseLogoUrl: franchise?.logo_url ?? null }; }),
    };
  }),

  startRookieLottery: protectedProcedure.input(z.object({ roundNumber: z.number().int().min(1).max(20).optional() }).optional()).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const roundNumber = input?.roundNumber ?? 2;
    const { league, season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle());
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC rookie draft has not been configured." });
    const existing = unwrap(await supabase.from("rookie_draft_lottery").select("id, status").eq("draft_id", draft.id).eq("round_number", roundNumber).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (existing && ["RUNNING", "PAUSED", "COMPLETE"].includes(existing.status)) throw new TRPCError({ code: "CONFLICT", message: `A round ${roundNumber} lottery has already been started or completed. Abort it before running a new draw.` });
    const picks = unwrap(await supabase.from("draft_pick").select("id, current_franchise_id").eq("draft_id", draft.id).eq("round_number", roundNumber).order("pick_number")) ?? [];
    if (picks.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: `Round ${roundNumber} needs at least two configured picks before the lottery can run.` });
    const franchiseIds = picks.map(pick => pick.current_franchise_id).filter((id): id is string => Boolean(id));
    if (franchiseIds.length !== picks.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Every round ${roundNumber} pick needs a franchise assigned before the lottery can shuffle them.` });
    const order = secureShuffle(franchiseIds);
    const commitment = lotteryCommitment(order);
    const now = new Date().toISOString();
    // A partial unique index (draft_id, round_number) where status in (RUNNING,PAUSED)
    // backs this up at the database level in case two start requests race past the
    // check above at nearly the same instant (double-click, two tabs/devices) -- the
    // losing insert fails with a unique violation (Postgres code 23505) rather than
    // silently creating a second active lottery that would prevent completion.
    const { data: inserted, error: insertError } = await supabase.from("rookie_draft_lottery").insert({ draft_id: draft.id, round_number: roundNumber, status: "RUNNING", franchise_order: order, franchise_count: order.length, order_commitment: commitment, reveal_interval_seconds: LOTTERY_REVEAL_INTERVAL_SECONDS, revealed_count: 0, started_at: now, elapsed_ms_before_pause: 0, created_by_owner_id: commissioner.id, updated_at: now }).select("id").single();
    if (insertError) {
      if (insertError.code === "23505") throw new TRPCError({ code: "CONFLICT", message: `A round ${roundNumber} lottery just started in another tab or by someone else. Refresh to see it.` });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insertError.message });
    }
    const lottery = inserted;
    if (!lottery) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The lottery could not be started." });
    await createAuditEvent(league.id, season.id, commissioner.id, "rookie_draft_lottery", lottery.id, "started", `Started the round ${roundNumber} rookie draft lottery (${order.length} franchises).`);
    return { lotteryId: lottery.id };
  }),

  pauseRookieLottery: protectedProcedure.input(z.object({ roundNumber: z.number().int().min(1).max(20).optional() }).optional()).mutation(async ({ ctx, input }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const roundNumber = input?.roundNumber ?? 2;
    const { season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle());
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC rookie draft has not been configured." });
    const lottery = unwrap(await supabase.from("rookie_draft_lottery").select("id, status, started_at, elapsed_ms_before_pause, revealed_count, franchise_count, reveal_interval_seconds, franchise_order").eq("draft_id", draft.id).eq("round_number", roundNumber).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (!lottery || lottery.status !== "RUNNING") throw new TRPCError({ code: "BAD_REQUEST", message: `There is no running round ${roundNumber} lottery to pause.` });
    const computed = revealedLotteryCount({ franchiseCount: lottery.franchise_count, revealIntervalSeconds: lottery.reveal_interval_seconds, revealedCount: lottery.revealed_count, elapsedMsBeforePause: Number(lottery.elapsed_ms_before_pause), startedAt: lottery.started_at, status: lottery.status });
    if (computed > lottery.revealed_count) {
      const positions = reverseLotteryPositions(lottery.franchise_order, computed).slice(lottery.revealed_count);
      if (positions.length) unwrap(await supabase.from("rookie_draft_lottery_reveal").upsert(positions.map(p => ({ lottery_id: lottery.id, reveal_index: p.revealIndex, draft_position: p.draftPosition, franchise_id: p.franchiseId })), { onConflict: "lottery_id,reveal_index", ignoreDuplicates: true }).select("id"));
    }
    const elapsed = Number(lottery.elapsed_ms_before_pause) + Math.max(0, Date.now() - new Date(lottery.started_at!).getTime());
    const now = new Date().toISOString();
    unwrap(await supabase.from("rookie_draft_lottery").update({ status: "PAUSED", revealed_count: computed, elapsed_ms_before_pause: elapsed, paused_at: now, updated_at: now }).eq("id", lottery.id).select("id").single());
    return { paused: true };
  }),

  resumeRookieLottery: protectedProcedure.input(z.object({ roundNumber: z.number().int().min(1).max(20).optional() }).optional()).mutation(async ({ ctx, input }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const roundNumber = input?.roundNumber ?? 2;
    const { season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle());
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC rookie draft has not been configured." });
    const lottery = unwrap(await supabase.from("rookie_draft_lottery").select("id, status").eq("draft_id", draft.id).eq("round_number", roundNumber).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (!lottery || lottery.status !== "PAUSED") throw new TRPCError({ code: "BAD_REQUEST", message: `There is no paused round ${roundNumber} lottery to resume.` });
    const now = new Date().toISOString();
    unwrap(await supabase.from("rookie_draft_lottery").update({ status: "RUNNING", started_at: now, paused_at: null, updated_at: now }).eq("id", lottery.id).select("id").single());
    return { resumed: true };
  }),

  abortRookieLottery: protectedProcedure.input(z.object({ roundNumber: z.number().int().min(1).max(20).optional(), reason: z.string().trim().min(4).max(500) })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const roundNumber = input.roundNumber ?? 2;
    const { league, season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle());
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC rookie draft has not been configured." });
    const lottery = unwrap(await supabase.from("rookie_draft_lottery").select("id, status").eq("draft_id", draft.id).eq("round_number", roundNumber).order("created_at", { ascending: false }).limit(1).maybeSingle());
    if (!lottery || !["RUNNING", "PAUSED", "READY"].includes(lottery.status)) throw new TRPCError({ code: "BAD_REQUEST", message: `There is no active round ${roundNumber} lottery to abort.` });
    const now = new Date().toISOString();
    unwrap(await supabase.from("rookie_draft_lottery").update({ status: "ABORTED", aborted_at: now, abort_reason: input.reason, updated_at: now }).eq("id", lottery.id).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "rookie_draft_lottery", lottery.id, "aborted", `Aborted the round ${roundNumber} rookie draft lottery: ${input.reason}`);
    return { aborted: true };
  }),

  saveDraft: protectedProcedure.input(z.object({ label: z.string().min(2).max(100), draftType: z.enum(["snake", "linear", "auction", "rookie", "supplemental"]), status: z.enum(["setup", "lottery", "live", "paused", "complete"]), pickTimerSeconds: z.number().int().min(0).max(7200).nullable().optional(), lotteryEnabled: z.boolean(), startsAt: z.string().datetime().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").upsert({ season_id: season.id, label: input.label, draft_type: input.draftType, status: input.status, pick_timer_seconds: input.pickTimerSeconds ?? null, lottery_enabled: input.lotteryEnabled, starts_at: input.startsAt ?? null, updated_at: new Date().toISOString() }, { onConflict: "season_id,draft_type" }).select("id, label, draft_type, status").single());
    if (!draft) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC draft could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "draft", draft.id, "saved", `Saved CVC ${draft.draft_type} draft ${draft.label}.`); return draft;
  }),

  saveDraftPick: protectedProcedure.input(z.object({ draftId: z.string().uuid(), roundNumber: z.number().int().min(1).max(30), pickNumber: z.number().int().min(1).max(500), franchiseId: z.string().uuid(), notes: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").select("id").eq("id", input.draftId).eq("season_id", season.id).maybeSingle()); if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC draft was not found." });
    const franchise = unwrap(await supabase.from("franchise").select("id, name").eq("id", input.franchiseId).eq("is_active", true).maybeSingle()); if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    const pick = unwrap(await supabase.from("draft_pick").upsert({ draft_id: draft.id, round_number: input.roundNumber, pick_number: input.pickNumber, original_franchise_id: franchise.id, current_franchise_id: franchise.id, notes: input.notes ?? null }, { onConflict: "draft_id,pick_number" }).select("id, pick_number").single());
    if (!pick) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC draft pick could not be saved." }); await createAuditEvent(league.id, season.id, commissioner.id, "draft_pick", pick.id, "saved", `Saved CVC pick ${pick.pick_number} for ${franchise.name}.`); return pick;
  }),

  eligibleRookies: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(1000).optional() }).optional()).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const limit = input?.limit ?? 20;
    const rookiePositions = ["QB", "RB", "WR", "TE", "K"];
    if (input?.position && !rookiePositions.includes(input.position.toUpperCase())) return [];
    let playerQuery = supabase.from("player").select("id, display_name, position, nfl_team, metadata").neq("provider", "placeholder").in("position", input?.position ? [input.position.toUpperCase()] : rookiePositions).order("display_name").limit(limit + 300);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    const [playersResult, activeAssignmentsResult, selectedPicksResult] = await Promise.all([
      playerQuery,
      supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).is("released_at", null),
      supabase.from("draft_pick").select("player_id, draft:draft_id(season_id)").not("player_id", "is", null),
    ]);
    const activePlayerIds = new Set((unwrap(activeAssignmentsResult) ?? []).map(assignment => assignment.player_id));
    // Same embedded-relation shape bug just fixed in recordDraftSelection: row.draft
    // can come back as a plain object, not always an array, so row.draft?.[0] silently
    // returned undefined and this filter never matched anything. In practice
    // activePlayerIds (via roster_assignment, set immediately by recordDraftSelection)
    // already excludes most already-drafted rookies, so this was a redundant
    // safety net rather than the primary defense -- but worth fixing correctly
    // regardless, rather than leaving a check that silently never does anything.
    const selectedPlayerIds = new Set((unwrap(selectedPicksResult) ?? []).filter((row: any) => (Array.isArray(row.draft) ? row.draft[0] : row.draft)?.season_id === season.id).map((row: any) => row.player_id));
    return (unwrap(playersResult) ?? []).filter(player => {
      const metadata = (player.metadata ?? {}) as { is_rookie?: boolean };
      return metadata.is_rookie && !activePlayerIds.has(player.id) && !selectedPlayerIds.has(player.id);
    }).slice(0, limit);
  }),

  // Records the outcome of an in-person rookie-draft selection: the pick-holding
  // franchise nominates a rookie live in the room and gets last right to match the
  // highest bid; if they pass, the highest bidder wins the player instead. So the
  // WINNING franchise (who the roster/contract go to) is independently selectable here
  // and can differ from the pick's owning franchise — the pick itself always records
  // which franchise originally held/nominated it (draft_pick.current_franchise_id,
  // already shown as "(Original franchise)" on the Rookie Draft board when it differs
  // from a traded pick's current owner — unrelated to who wins the player).
  recordDraftSelection: protectedProcedure.input(z.object({ draftPickId: z.string().uuid(), playerId: z.string().uuid(), winningFranchiseId: z.string().uuid(), salary: z.number().int().min(0).max(115), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const pick = unwrap(await supabase.from("draft_pick").select("id, draft_id, current_franchise_id, round_number, pick_number, pick_status, draft:draft_id(season_id, draft_type)").eq("id", input.draftPickId).maybeSingle());
    // Supabase embedded relations can come back as either an array or a single object
    // depending on the relationship shape -- pick.draft?.[0] assumed it was always an
    // array. When it's actually a plain object, that indexing silently returns
    // undefined, so the season_id check below always failed and every valid, open pick
    // got rejected as "not available for selection" regardless of its real state.
    // Confirmed live: all 20 rookie-draft picks showed pick_status='open' in the
    // database, yet recording a selection failed on every one of them.
    const pickDraft = Array.isArray(pick?.draft) ? pick.draft[0] : pick?.draft;
    if (!pick || pickDraft?.season_id !== season.id || pick.pick_status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This CVC draft pick is not available for selection." });
    if (!['rookie', 'supplemental'].includes(pickDraft?.draft_type ?? '')) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC player selection is reserved for rookie or supplemental drafts." });
    const winningFranchise = unwrap(await supabase.from("franchise").select("id, name").eq("id", input.winningFranchiseId).eq("league_id", league.id).eq("is_active", true).maybeSingle());
    if (!winningFranchise) throw new TRPCError({ code: "NOT_FOUND", message: "The winning CVC franchise was not found." });
    const player = unwrap(await supabase.from("player").select("id, display_name, metadata").eq("id", input.playerId).maybeSingle()); if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    if (!(player.metadata as { is_rookie?: boolean } | null)?.is_rookie) throw new TRPCError({ code: "BAD_REQUEST", message: "Only players marked as rookies are eligible for the CVC rookie draft." });
    const active = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", player.id).is("released_at", null).limit(1).maybeSingle()); if (active) throw new TRPCError({ code: "BAD_REQUEST", message: "This rookie is already on a CVC roster." });
    unwrap(await supabase.from("draft_pick").update({ player_id: player.id, pick_status: "selected", selected_at: new Date().toISOString(), notes: input.note ?? null }).eq("id", pick.id).select("id").single());
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: input.winningFranchiseId, player_id: player.id, roster_state: "active" }).select("id").single());
    // Every rookie-draft selection gets a fixed 3-year contract regardless of salary
    // (unlike auction picks, where term length depends on salary) and is tagged with
    // the "R" source marker so it's identifiable as a rookie-draft-originated contract
    // elsewhere in the app (e.g. the Rosters page contract/right marker).
    // Corrected: a 3-year rookie contract drafted in season.year covers season.year
    // through season.year+2 (3 seasons total) and expires_year should be
    // season.year + 3 (2029 for 2026), not season.year + 3 - 1 (2028) -- same fix as
    // the auction contract creation above.
    unwrap(await supabase.from("player_contract").upsert({ season_id: season.id, franchise_id: input.winningFranchiseId, player_id: player.id, salary: input.salary, expires_year: season.year + 3, source_marker: "R", contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: input.winningFranchiseId, actor_owner_id: commissioner.id, transaction_type: "draft_pick", status: "final", summary: `CVC rookie draft R${pick.round_number}.${String(pick.pick_number).padStart(2, "0")}: ${player.display_name} to ${winningFranchise.name} for $${input.salary}`, details: { draft_pick_id: pick.id, player_id: player.id, salary: input.salary, pick_holder_franchise_id: pick.current_franchise_id } }).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "draft_pick", pick.id, "selected", `Recorded CVC rookie draft selection ${player.display_name} to ${winningFranchise.name}.`); return { selected: true };
  }),

  // Undoes a rookie-draft selection: releases the roster spot, marks the contract
  // released, and resets the pick back to open so it can be re-recorded. Mirrors
  // auction.correctAward exactly (same release/release/reset/log pattern) -- the
  // rookie draft previously had no equivalent correction path at all.
  correctDraftSelection: protectedProcedure.input(z.object({ draftPickId: z.string().uuid(), reason: z.string().trim().max(280).optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const pick = unwrap(await supabase.from("draft_pick").select("id, player_id, current_franchise_id, round_number, pick_number, pick_status, draft:draft_id(season_id, draft_type)").eq("id", input.draftPickId).maybeSingle());
    const pickDraft = Array.isArray(pick?.draft) ? pick.draft[0] : pick?.draft;
    if (!pick || pickDraft?.season_id !== season.id || pick.pick_status !== "selected" || !pick.player_id) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a completed CVC rookie draft selection can be corrected." });
    if (!['rookie', 'supplemental'].includes(pickDraft?.draft_type ?? '')) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC selection correction is reserved for rookie or supplemental drafts." });
    const roster = unwrap(await supabase.from("roster_assignment").select("id, franchise_id").eq("season_id", season.id).eq("player_id", pick.player_id).is("released_at", null).order("acquired_at", { ascending: false }).limit(1).maybeSingle());
    if (!roster) throw new TRPCError({ code: "CONFLICT", message: "The selection cannot be corrected because its active roster record is unavailable." });
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", pick.player_id).maybeSingle());
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", roster.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", season.id).eq("franchise_id", roster.franchise_id).eq("player_id", pick.player_id).select("id"));
    unwrap(await supabase.from("draft_pick").update({ player_id: null, pick_status: "open", selected_at: null, notes: input.reason ?? "Commissioner correction" }).eq("id", pick.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: roster.franchise_id, actor_owner_id: commissioner.id, transaction_type: "commissioner_adjustment", status: "final", summary: `Rookie draft selection corrected: R${pick.round_number}.${String(pick.pick_number).padStart(2, "0")} reopened`, details: { draft_pick_id: pick.id, player_id: pick.player_id, reason: input.reason } }).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "draft_pick", pick.id, "corrected", `Corrected CVC rookie draft selection ${player?.display_name ?? "a player"} — pick reopened.`);
    return { success: true } as const;
  }),

  franchiseRoster: publicProcedure.input(z.object({ franchiseId: z.string().uuid() })).query(async ({ input }) => {
    const { data: franchise, error: franchiseError } = await supabase.from("franchise").select("id, name, abbreviation, division_name, brand_color, logo_url, current_owner_id").eq("id", input.franchiseId).single();
    if (franchiseError || !franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    const { season } = await getCurrentLeagueAndSeason();
    const assignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, roster_state, assigned_slot_code, acquired_at").eq("season_id", season.id).eq("franchise_id", franchise.id).is("released_at", null).order("acquired_at")) ?? [];
    const releasedAssignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, released_at").eq("season_id", season.id).eq("franchise_id", franchise.id).not("released_at", "is", null).order("released_at", { ascending: false })) ?? [];
    const playerIds = assignments.map(item => item.player_id);
    const releasedPlayerIds = releasedAssignments.map(item => item.player_id);
    const rawPlayers = playerIds.length ? unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").in("id", playerIds)) ?? [] : [];
    const players = await attachSeasonStats(rawPlayers, season.id);
    const contracts = playerIds.length ? unwrap(await supabase.from("player_contract").select("player_id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).in("player_id", playerIds)) ?? [] : [];
    const releasedPlayers = releasedPlayerIds.length ? unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").in("id", releasedPlayerIds)) ?? [] : [];
    const releasedContracts = releasedPlayerIds.length ? unwrap(await supabase.from("player_contract").select("player_id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).in("player_id", releasedPlayerIds)) ?? [] : [];
    const [rights, historicalRights, franchiseTags]: [any[], any[], any[]] = playerIds.length ? await Promise.all([
      unwrap(await supabase.from("player_right").select("id, player_id, right_type, status, salary_basis, contract_years, expires_year, metadata").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("status", "active").in("player_id", playerIds)) ?? [],
      unwrap(await supabase.from("player_right").select("player_id, right_type, status, salary_basis, contract_years, metadata").in("player_id", playerIds)) ?? [],
      unwrap(await supabase.from("player_right").select("player_id, salary_basis, contract_years, metadata").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("right_type", "franchise").eq("status", "active")) ?? [],
    ]) : [[], [], []];
    const playerById = new Map(players.map(player => [player.id, player]));
    const contractByPlayerId = new Map(contracts.map(contract => [contract.player_id, contract]));
    const releasedPlayerById = new Map(releasedPlayers.map(player => [player.id, player]));
    const releasedContractByPlayerId = new Map(releasedContracts.map(contract => [contract.player_id, contract]));
    const rightsByPlayerId = new Map<string, typeof rights>();
    rights.forEach(right => rightsByPlayerId.set(right.player_id, [...(rightsByPlayerId.get(right.player_id) ?? []), right]));
    const historicalByPlayerId = new Map<string, typeof historicalRights>();
    historicalRights.forEach(right => historicalByPlayerId.set(right.player_id, [...(historicalByPlayerId.get(right.player_id) ?? []), right]));
    const twoYearTagTaken = franchiseTags.some(tag => cvcContractTier(Number(tag.salary_basis), tag.metadata?.term_tier) === "two_year" || tag.contract_years === 2);
    const threeYearTagTaken = franchiseTags.some(tag => cvcContractTier(Number(tag.salary_basis), tag.metadata?.term_tier) === "three_year" || tag.contract_years === 3);
    const playersWithEligibility = assignments.map(assignment => {
      const contract = contractByPlayerId.get(assignment.player_id) ?? null; const activeRights = rightsByPlayerId.get(assignment.player_id) ?? []; const history = historicalByPlayerId.get(assignment.player_id) ?? [];
      const actions: Array<"cut" | "franchise_2" | "franchise_3" | "transition" | "rookie_match" | "waiver_match"> = [];
      if (contract && !activeRights.length) {
        const marker = (contract.source_marker ?? "").trim().toUpperCase();
        const expiring = isCvcProtectionYear(contract.expires_year, season.year);
        if (expiring && marker === "R") {
          actions.push("rookie_match");
        } else if (expiring && marker === "W") {
          actions.push("waiver_match");
        } else {
          actions.push("cut");
          if (expiring) {
            const termTier = cvcContractTier(Number(contract.salary), contract.source_marker);
            const highTransition = history.some(isCvcHighSalaryTransition); const hasTransition = history.some(right => right.right_type === "transition"); const hasFranchise = history.some(right => right.right_type === "franchise");
            if (!highTransition && (termTier === "two_year" ? !twoYearTagTaken : !threeYearTagTaken)) actions.push(termTier === "two_year" ? "franchise_2" : "franchise_3");
            if (!hasTransition && !hasFranchise) actions.push("transition");
          }
        }
      }
      return { ...assignment, player: playerById.get(assignment.player_id) ?? null, contract, rights: activeRights, protectionEligibility: { availableActions: actions } };
    });
    return {
      franchise,
      players: playersWithEligibility,
      cutPlayers: releasedAssignments.map(assignment => ({ ...assignment, player: releasedPlayerById.get(assignment.player_id) ?? null, contract: releasedContractByPlayerId.get(assignment.player_id) ?? null })),
      restrictedPlayers: playersWithEligibility.filter(item => item.rights.some((right: any) => ["rookie_match", "waiver_match"].includes(right.right_type))),
    };
  }),

  // Scoped to exactly what's actually tradeable: this year's picks (only while that
  // draft hasn't completed) and next year's -- matches the same rule proposeTrade
  // enforces, so the trade builder UI never even offers an invalid pick as an option.
  franchisePicks: publicProcedure.input(z.object({ franchiseId: z.string().uuid() })).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const picks = unwrap(await supabase.from("draft_pick").select("id, round_number, pick_number, pick_status, draft:draft_id(draft_type, status, season:season_id(year))").eq("current_franchise_id", input.franchiseId).eq("pick_status", "open").order("round_number").order("pick_number").limit(100)) ?? [];
    return picks
      .map((pick: any) => {
        const draft = Array.isArray(pick.draft) ? pick.draft[0] : pick.draft;
        const draftSeason = draft ? (Array.isArray(draft.season) ? draft.season[0] : draft.season) : null;
        return { id: pick.id, roundNumber: pick.round_number, pickNumber: pick.pick_number, draftType: draft?.draft_type ?? "rookie", year: draftSeason?.year ?? null, draftStatus: draft?.status ?? null };
      })
      .filter(pick => pick.year != null && (pick.year === season.year || pick.year === season.year + 1) && !(pick.year === season.year && pick.draftStatus === "complete"));
  }),

  // Unbounded (unlike playerDirectory's 150-row cap), because this exists purely so the
  // News page can match Tank01 headlines against the full eligible-position player
  // universe client-side -- capping it would silently miss real matches for players who
  // just don't happen to sort into the first 150 alphabetically.
  newsPlayerIndex: publicProcedure.query(async () => {
    return unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, metadata").in("position", ["QB", "RB", "WR", "TE", "K"])) ?? [];
  }),

  playerDirectory: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(150).optional() }).optional()).query(async ({ input }) => {
    const limit = input?.limit ?? 75;
    let query = supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").order("display_name").limit(limit);
    if (input?.search) query = query.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) query = query.eq("position", input.position);
    const players = unwrap(await query) ?? [];
    return players;
  }),

  freeAgents: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(1000).optional(), matchingRightsOnly: z.boolean().optional() }).optional()).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const limit = input?.limit ?? 75;
    const eligiblePositions = ["QB", "RB", "WR", "TE", "K", "DST"];
    if (input?.position && !eligiblePositions.includes(input.position.toUpperCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC Free Agents are limited to QB, RB, WR, TE, K, and D/ST." });
    const activeAssignmentsResult = await supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).is("released_at", null);
    const activePlayerIds = new Set((unwrap(activeAssignmentsResult) ?? []).map(assignment => assignment.player_id));

    if (input?.matchingRightsOnly) {
      // Dedicated path: start from tagged contracts directly rather than the general
      // (alphabetically-truncated) player pool below, so every tagged free agent is
      // findable regardless of where their name falls alphabetically.
      let tagQuery = supabase.from("player_contract").select("player_id, last_cut_tag_type, updated_at, franchise:last_cut_by_franchise_id(name), player:player_id(id, provider, display_name, position, nfl_team, status, metadata)").eq("season_id", season.id).eq("contract_status", "released").not("last_cut_by_franchise_id", "is", null).order("updated_at", { ascending: false }).limit(300);
      const tagRows = unwrap(await tagQuery) ?? [];
      const rosteredPlayers = activePlayerIds.size ? unwrap(await supabase.from("player").select("display_name").in("id", Array.from(activePlayerIds))) ?? [] : [];
      const activePlayerNames = new Set(rosteredPlayers.map(player => player.display_name.trim().toLowerCase().replace(/\s+/g, " ")));
      const seen = new Set<string>();
      const tagged: any[] = [];
      for (const row of tagRows as any[]) {
        const player = Array.isArray(row.player) ? row.player[0] : row.player;
        if (!player || seen.has(player.id)) continue;
        if (player.provider === "placeholder" || !eligiblePositions.includes(player.position)) continue;
        if (activePlayerIds.has(player.id) || activePlayerNames.has(player.display_name.trim().toLowerCase().replace(/\s+/g, " "))) continue;
        if (input?.position && player.position !== input.position.toUpperCase()) continue;
        if (input?.search && !player.display_name.toLowerCase().includes(input.search.toLowerCase())) continue;
        const franchiseField = row.franchise as { name: string } | { name: string }[] | null;
        const franchiseName = Array.isArray(franchiseField) ? franchiseField[0]?.name : franchiseField?.name;
        if (!franchiseName) continue;
        seen.add(player.id);
        tagged.push({ ...player, cutByFranchiseName: franchiseName, cutTagType: row.last_cut_tag_type });
      }
      tagged.sort((a, b) => a.display_name.localeCompare(b.display_name));
      const page = tagged.slice(0, limit);
      return attachSeasonStats(page, season.id);
    }

    let playerQuery = supabase.from("player").select("id, provider, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").in("position", eligiblePositions).order("display_name").limit(limit + 220);
    // Same last_seen_at filter as auction.eligiblePlayers, excluding players who dropped
    // off FantasyPros' most recent ROS-rankings-confirmed active list (see
    // syncFantasyProsActiveFlags). Not applied to the matchingRightsOnly path above -- a
    // matching-rights tag means the player was just actively rostered, a stronger and
    // more specific signal on its own. Skipped entirely if no active-flag sync has ever
    // run (fails open, not closed, so it never hides the whole pool).
    const mostRecentSync = unwrap(await supabase.from("player").select("last_seen_at").not("last_seen_at", "is", null).order("last_seen_at", { ascending: false }).limit(1).maybeSingle());
    if (mostRecentSync?.last_seen_at) playerQuery = playerQuery.gte("last_seen_at", mostRecentSync.last_seen_at);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position.toUpperCase());
    const players = unwrap(await playerQuery) ?? [];
    const rosteredPlayers = activePlayerIds.size ? unwrap(await supabase.from("player").select("display_name").in("id", Array.from(activePlayerIds))) ?? [] : [];
    const activePlayerNames = new Set(rosteredPlayers.map(player => player.display_name.trim().toLowerCase().replace(/\s+/g, " ")));
    const freeAgentPool = players.filter(player => !activePlayerIds.has(player.id) && !activePlayerNames.has(player.display_name.trim().toLowerCase().replace(/\s+/g, " "))).slice(0, limit);

    // Surface a "Matching rights: <franchise>" tag for players who held an active
    // rookie-match or waiver-match right at the moment they were released — visual
    // only, doesn't affect availability or auction matching-rights logic.
    const freeAgentIds = freeAgentPool.map(player => player.id);
    const cutTags = freeAgentIds.length
      ? unwrap(await supabase.from("player_contract").select("player_id, last_cut_tag_type, updated_at, franchise:last_cut_by_franchise_id(name)").eq("season_id", season.id).eq("contract_status", "released").not("last_cut_by_franchise_id", "is", null).in("player_id", freeAgentIds)) ?? []
      : [];
    const latestCutTagByPlayerId = new Map<string, { franchiseName: string; tagType: string; updatedAt: string }>();
    for (const row of cutTags as any[]) {
      const existing = latestCutTagByPlayerId.get(row.player_id);
      const franchiseField = row.franchise as { name: string } | { name: string }[] | null;
      const name = Array.isArray(franchiseField) ? franchiseField[0]?.name : franchiseField?.name;
      if (!name) continue;
      if (!existing || new Date(row.updated_at) > new Date(existing.updatedAt)) {
        latestCutTagByPlayerId.set(row.player_id, { franchiseName: name, tagType: row.last_cut_tag_type, updatedAt: row.updated_at });
      }
    }
    const tagged = freeAgentPool.map(player => {
      const tag = latestCutTagByPlayerId.get(player.id);
      return tag ? { ...player, cutByFranchiseName: tag.franchiseName, cutTagType: tag.tagType } : player;
    });
    return attachSeasonStats(tagged, season.id);
  }),

  // "All Players" tab equivalent -- same eligible-position pool as freeAgents, but
  // without excluding rostered players. Each rostered player is tagged with their
  // owning franchise name so the page can show "Rostered · <Franchise>" instead of
  // "Available".
  allPlayers: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(1000).optional() }).optional()).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const limit = input?.limit ?? 200;
    const eligiblePositions = ["QB", "RB", "WR", "TE", "K", "DST"];
    if (input?.position && !eligiblePositions.includes(input.position.toUpperCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC players are limited to QB, RB, WR, TE, K, and D/ST." });
    let playerQuery = supabase.from("player").select("id, provider, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").in("position", eligiblePositions).order("display_name").limit(limit);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position.toUpperCase());
    const players = unwrap(await playerQuery) ?? [];
    const assignments = unwrap(await supabase.from("roster_assignment").select("player_id, franchise:franchise_id(name)").eq("season_id", season.id).is("released_at", null).in("player_id", players.map(player => player.id))) ?? [];
    const franchiseByPlayerId = new Map<string, string>();
    for (const row of assignments as any[]) {
      const franchiseField = row.franchise as { name: string } | { name: string }[] | null;
      const name = Array.isArray(franchiseField) ? franchiseField[0]?.name : franchiseField?.name;
      if (name) franchiseByPlayerId.set(row.player_id, name);
    }
    const tagged = players.map(player => {
      const franchiseName = franchiseByPlayerId.get(player.id);
      return franchiseName ? { ...player, rosteredByFranchiseName: franchiseName } : player;
    });
    return attachSeasonStats(tagged, season.id);
  }),

  // Watchlist tab: resolves the owner's saved player ids into full player + season-stat
  // rows, same shape as freeAgents/allPlayers so the page can render them identically.
  watchlistPlayers: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) return [];
    const { season } = await getCurrentLeagueAndSeason();
    const watched = unwrap(await supabase.from("watchlist").select("player_id").eq("franchise_id", franchise.id)) ?? [];
    if (!watched.length) return [];
    const players = unwrap(await supabase.from("player").select("id, provider, display_name, position, nfl_team, status, metadata").in("id", watched.map(row => row.player_id))) ?? [];
    return attachSeasonStats(players, season.id);
  }),


  playerDetail: publicProcedure.input(z.object({ playerId: z.string().uuid() })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("id, provider, external_id, display_name, position, nfl_team, status, metadata, created_at, updated_at").eq("id", input.playerId).maybeSingle());
    if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    const { season } = await getCurrentLeagueAndSeason();
    // Not filtered to roster_state='active' -- a benched player (including every
    // waiver-acquired player, which always starts on the bench) is still owned by that
    // franchise and should still show ownership here.
    const assignment = unwrap(await supabase.from("roster_assignment").select("franchise_id, acquired_at, assigned_slot_code").eq("season_id", season.id).eq("player_id", player.id).is("released_at", null).maybeSingle());
    const contract = assignment ? unwrap(await supabase.from("player_contract").select("salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", assignment.franchise_id).eq("player_id", player.id).maybeSingle()) : null;
    const franchise = assignment ? unwrap(await supabase.from("franchise").select("id, name, logo_url, current_owner_id").eq("id", assignment.franchise_id).maybeSingle()) : null;
    const owner = franchise ? unwrap(await supabase.from("owner").select("display_name").eq("id", franchise.current_owner_id).maybeSingle()) : null;
    return {
      ...player,
      season: { id: season.id, year: season.year },
      ownership: franchise ? { franchiseId: franchise.id, franchiseName: franchise.name, franchiseLogoUrl: franchise.logo_url, ownerName: owner?.display_name ?? null, acquiredAt: assignment?.acquired_at ?? null, assignedSlotCode: assignment?.assigned_slot_code ?? null } : null,
      contract,
    };
  }),

  nflProviderStatus: publicProcedure.query(async () => getNFLDataAdapter().status()),

  fantasyProsCacheStatus: publicProcedure.query(async () => fantasyProsCacheStatus()),

  // Powers the News page's FantasyPros source. FantasyPros' own news items only carry a
  // team_id, not position -- rather than round-tripping through their consensus-rankings
  // endpoints per position (as WRC's model does, since WRC has no authoritative player
  // table of its own), CVC already has real player records with position/nfl_team, so a
  // single name-matched lookup against `player` fills in position/team more simply, and
  // also gives us the exact display_name/nfl_team CVC already uses everywhere else.
  fantasyProsNews: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(async ({ input }) => {
    const rawItems = await getFantasyProsNews(input?.limit ?? 100);
    const eligible = new Set(["QB", "RB", "WR", "TE", "K"]);
    const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").in("position", Array.from(eligible))) ?? [];
    const normalize = (name: string) => name.toLowerCase().replace(/\./g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
    const byName = new Map(players.map(row => [normalize(row.display_name), row]));
    const injuryKeywords = ["injured", "injury", "questionable", "doubtful", "out", " ir ", "placed on", "ruled out", "limited", "missed", "surgery", "knee", "hamstring", "ankle", "shoulder", "concussion", "rib", "back", "wrist", "hip", "illness"];
    const items = rawItems
      .map(item => {
        const match = byName.get(normalize(item.playerName));
        const text = `${item.title} ${item.description} ${item.impact}`.toLowerCase();
        return {
          ...item,
          playerId: match?.id ?? null,
          playerName: match?.display_name || item.playerName,
          position: match?.position ?? null,
          team: match?.nfl_team || item.team,
          isInjury: injuryKeywords.some(keyword => text.includes(keyword)),
        };
      })
      .filter(item => item.position && eligible.has(item.position));
    return { items };
  }),

  // Powers the Standings page's Injuries panel. Resolves "current week" the same way
  // liveScoringBoard does (first 'live' week, falling back to first 'upcoming') rather
  // than computing it from a hardcoded date table like WRC's getCurrentWeek(), since CVC
  // already tracks this in schedule_week.
  fantasyProsInjuries: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number, status").eq("season_id", season.id).order("week_number")) ?? [];
    const currentWeek = weeks.find(item => item.status === "live") ?? weeks.find(item => item.status === "upcoming") ?? weeks[0];
    if (!currentWeek) return { items: [], weekNumber: null };
    const rawInjuries = await getFantasyProsInjuries(season.year, currentWeek.week_number);
    const eligible = new Set(["QB", "RB", "WR", "TE", "K"]);
    const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").in("position", Array.from(eligible))) ?? [];
    const normalize = (name: string) => name.toLowerCase().replace(/\./g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
    const byName = new Map(players.map(row => [normalize(row.display_name), row]));
    const items = rawInjuries
      .map(injury => {
        const match = byName.get(normalize(injury.name));
        const status = injury.shortStatus || injury.status || "Injury update";
        const description = [
          injury.comment || `${injury.name} is currently listed as ${status}.`,
          injury.practiceInjuryType ? `Practice injury: ${injury.practiceInjuryType}` : "",
          injury.probabilityOfPlaying != null ? `${injury.probabilityOfPlaying}% chance to play` : "",
          injury.practices.length ? `Practice: ${injury.practices.join(" / ")}` : "",
        ].filter(Boolean).join(" · ");
        return {
          playerId: match?.id ?? null,
          playerName: match?.display_name || injury.name,
          position: match?.position ?? injury.position,
          team: match?.nfl_team || injury.team,
          headline: `${status}${injury.injuryType ? ` · ${injury.injuryType}` : ""}`,
          description,
          published: injury.updated || new Date().toISOString(),
        };
      })
      .filter(item => item.position && eligible.has(item.position));
    return { items, weekNumber: currentWeek.week_number };
  }),

  // Multi-year season-by-season stats, powering the player profile's Stats tab. Uses
  // ESPN's public gamelog API (no key required) but computes CVC's own fantasy points
  // from this season's actual scoring_rule rows, not a hardcoded formula.
  playerCareerSeasonStats: publicProcedure.input(z.object({ playerId: z.string().uuid(), espnId: z.string().min(1) })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("position").eq("id", input.playerId).maybeSingle());
    if (!player?.position) return { seasons: [] };
    const { season } = await getCurrentLeagueAndSeason();
    const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
    const seasons = await getCvcPlayerCareerStats(input.espnId, player.position, rules, season.year);
    return { seasons };
  }),

  // Per-game log for one season, powering the player profile's Game Log tab. Needs the
  // player's confirmed Tank01 playerID (from the client's already-fetched Tank01 info
  // response) rather than searching by name again.
  playerGameLog: publicProcedure.input(z.object({ playerId: z.string().uuid(), tank01PlayerId: z.string().min(1), year: z.number().int() })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("position, nfl_team").eq("id", input.playerId).maybeSingle());
    if (!player?.position) return { games: [] };
    const adapter = getNFLDataAdapter();
    if (!(adapter instanceof Tank01NFLDataAdapter)) return { games: [] };
    const { season } = await getCurrentLeagueAndSeason();
    const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
    const body = await adapter.getGamesForPlayer(input.tank01PlayerId, input.year).catch(() => ({}));
    const games = parseCvcGameLog(body, player.nfl_team ?? "", player.position, rules);
    return { games };
  }),


  // Position rank + overall rank ("OP" = FantasyPros' cross-position overall/superflex
  // code) come from their consensus-rankings endpoint; the weekly point projection from
  // their separate projections endpoint. Filtered server-side to just this one player
  // (via the shared canonical name normalizer) rather than shipping WRC's approach of
  // fetching the whole ranked list to the client and filtering there.
  fantasyProsPlayerOutlook: publicProcedure.input(z.object({ playerId: z.string().uuid() })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("display_name, position").eq("id", input.playerId).maybeSingle());
    if (!player || !player.position || !["QB", "RB", "WR", "TE", "K"].includes(player.position)) {
      return { positionRank: null, overallRank: null, projection: null, weekNumber: null };
    }
    const { season } = await getCurrentLeagueAndSeason();
    const weeks = unwrap(await supabase.from("schedule_week").select("week_number, status").eq("season_id", season.id).order("week_number")) ?? [];
    const currentWeek = (weeks.find(item => item.status === "live") ?? weeks.find(item => item.status === "upcoming") ?? weeks[0])?.week_number ?? 0;
    const [positionRanks, overallRanks, projections] = await Promise.all([
      getFantasyProsRanks(season.year, player.position, currentWeek),
      getFantasyProsRanks(season.year, "OP", currentWeek),
      getFantasyProsProjections(season.year, player.position, currentWeek),
    ]);
    const targetName = normalizePlayerName(player.display_name);
    const positionRank = positionRanks.find(row => normalizePlayerName(row.name) === targetName) ?? null;
    const overallRank = overallRanks.find(row => normalizePlayerName(row.name) === targetName) ?? null;
    const projection = projections.find(row => normalizePlayerName(row.name) === targetName) ?? null;
    return { positionRank, overallRank, projection, weekNumber: currentWeek || null };
  }),

  refreshFantasyProsPlayers: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const adapter = getFantasyProsDataAdapter();
    if (!adapter) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    const snapshot = await adapter.listPlayerSnapshot();
    const payloadCount = Array.isArray(snapshot.payload) ? snapshot.payload.length : Array.isArray((snapshot.payload as { players?: unknown[] })?.players) ? ((snapshot.payload as { players: unknown[] }).players.length) : null;
    return { provider: snapshot.provider, source: snapshot.source, fetchedAt: snapshot.fetchedAt, expiresAt: snapshot.expiresAt, playerCount: payloadCount, lastError: snapshot.lastError };
  }),

  // Commissioner-triggered (matches the established preference for manual sync buttons
  // over cron jobs, given prior cron reliability issues in this codebase). Pulls the
  // current nflverse roster CSV and corrects any stale player.nfl_team values directly --
  // same root fix as the recent Travis Etienne / JAC-JAX / WAS-WSH cleanup, now automated
  // going forward instead of needing another one-off manual SQL pass.
  syncNflTeamAssignments: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    return syncNflTeamAssignments();
  }),

  syncFantasyProsPlayers: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const adapter = getFantasyProsDataAdapter();
    if (!adapter) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    return syncFantasyProsSnapshot(await adapter.listPlayerSnapshot());
  }),

  syncFantasyProsActive: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    if (!process.env.FANTASYPROS_API_KEY) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    const { season } = await getCurrentLeagueAndSeason();
    const { idsByPosition, errors } = await getFantasyProsActivePlayerIds(season.year);
    return syncFantasyProsActiveFlags(idsByPosition, errors);
  }),

  syncTank01ActiveRoster: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    return syncTank01ActiveRoster();
  }),

  syncFantasyProsRookies: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    if (!process.env.FANTASYPROS_API_KEY) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    const { season } = await getCurrentLeagueAndSeason();
    const { idsByPosition, errors, samplePlayers } = await getFantasyProsRookiePlayerIds(season.year);
    const result = await syncFantasyProsRookieFlags(idsByPosition, errors);
    return { ...result, samplePlayers };
  }),

  syncSeasonStats: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).mutation(async ({ ctx, input }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    return syncTank01SeasonStats(season.id, input?.limit ?? 40);
  }),

  waiverStatus: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    const now = new Date().toISOString();
    const period = unwrap(await supabase.from("waiver_period").select("id, label, opens_at, closes_at, status, period_type").eq("season_id", season.id).eq("status", "open").lte("opens_at", now).gte("closes_at", now).order("closes_at").limit(1).maybeSingle());
    return { period };
  }),

  createWaiverPeriod: protectedProcedure.input(z.object({ label: z.string().min(2).max(100), opensAt: z.string().datetime(), closesAt: z.string().datetime(), periodType: z.enum(["bid", "free"]).default("bid") }).refine(value => new Date(value.closesAt) > new Date(value.opensAt), { message: "A waiver period must close after it opens." })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const period = unwrap(await supabase.from("waiver_period").insert({ season_id: season.id, label: input.label, opens_at: input.opensAt, closes_at: input.closesAt, status: "open", period_type: input.periodType }).select("id, label, opens_at, closes_at, status, period_type").single());
    if (!period) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC waiver period could not be created." });
    await createAuditEvent(league.id, season.id, commissioner.id, "waiver_period", period.id, "created", `Opened waiver period ${period.label}`);
    return period;
  }),

  submitFaabBid: protectedProcedure.input(z.object({ playerId: z.string().uuid(), amount: z.number().int().min(1).max(30), maxPlayersDesired: z.number().int().min(1).max(10).default(1), priority: z.number().int().min(1).max(99).default(1), dropPlayerId: z.string().uuid().optional() })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to submit a waiver claim." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner with an active CVC franchise may submit a waiver claim." });
    const now = new Date().toISOString();
    const period = unwrap(await supabase.from("waiver_period").select("id, label, period_type").eq("season_id", season.id).eq("status", "open").lte("opens_at", now).gte("closes_at", now).order("closes_at").limit(1).maybeSingle());
    if (!period) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There is no open CVC waiver period." });
    // The free agent period (post-Sunday, bid-exempt) is always a flat $1 claim awarded
    // by waiver priority, regardless of whatever amount was submitted -- ignore the
    // client's amount entirely rather than trusting it, matching how a real waiver claim
    // (not a bid) works.
    const isFreePeriod = period.period_type === "free";
    const amount = isFreePeriod ? 1 : input.amount;
    // $30 season cap: a bid can't itself exceed what's left, accounting for every other
    // *pending* bid this franchise already has open this period too (not just already-won
    // bids) -- otherwise an owner could submit several $30 bids simultaneously and only
    // get caught at resolution time, when it's too late to bid smarter.
    const balance = await getFaabBalance(franchise.id, season.id);
    const otherPendingThisPeriod = (unwrap(await supabase.from("faab_bid").select("amount").eq("waiver_period_id", period.id).eq("franchise_id", franchise.id).eq("status", "pending").neq("player_id", input.playerId)) ?? []).reduce((total, bid) => total + bid.amount, 0);
    if (amount > balance - otherPendingThisPeriod) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `This ${isFreePeriod ? "claim" : "bid"} exceeds your remaining CVC FAAB budget. You have $${balance} left this season${otherPendingThisPeriod ? ` ($${otherPendingThisPeriod} already committed to other pending claims this period)` : ""}.` });
    }
    const [player, activeAssignment] = await Promise.all([
      supabase.from("player").select("id, display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1).maybeSingle(),
    ]);
    const playerRow = unwrap(player);
    if (!playerRow) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    if (unwrap(activeAssignment)) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players cannot be claimed through waivers." });
    if (input.dropPlayerId) {
      const drop = unwrap(await supabase.from("roster_assignment").select("id, locked_until").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.dropPlayerId).is("released_at", null).maybeSingle());
      if (!drop) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected drop player is not on your active CVC roster." });
      if (drop.locked_until && new Date(drop.locked_until).getTime() > Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This player was just acquired via waivers and can't be cut until the next waiver resolution (${new Date(drop.locked_until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}).` });
      }
    }
    const bid = unwrap(await supabase.from("faab_bid").upsert({ waiver_period_id: period.id, franchise_id: franchise.id, player_id: input.playerId, drop_player_id: input.dropPlayerId ?? null, amount, priority: input.priority, max_players_desired: input.maxPlayersDesired, status: "pending" }, { onConflict: "waiver_period_id,franchise_id,player_id" }).select("id, amount, priority, status").single());
    if (!bid) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC waiver claim could not be saved." });
    await createAuditEvent(league.id, season.id, owner.id, "faab_bid", bid.id, "submitted", `Submitted ${period.label} claim for ${playerRow.display_name}`);
    return bid;
  }),

  myFaabBids: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) return [];
    return unwrap(await supabase.from("faab_bid").select("id, amount, priority, status, submitted_at, player:player_id(id, display_name, position, nfl_team), period:waiver_period_id(label, closes_at, status)").eq("franchise_id", franchise.id).order("submitted_at", { ascending: false }).limit(100)) ?? [];
  }),

  // CVC's real season FAAB budget: $30 per franchise, spent in $1 increments across the
  // whole season (not per-bid).
  myFaabBalance: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) return { balance: null };
    const { season } = await getCurrentLeagueAndSeason();
    return { balance: await getFaabBalance(franchise.id, season.id) };
  }),

  watchlist: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) return [];
    return unwrap(await supabase.from("watchlist").select("player_id, added_at").eq("franchise_id", franchise.id).order("added_at", { ascending: false })) ?? [];
  }),

  toggleWatchlistPlayer: protectedProcedure.input(z.object({ playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "FORBIDDEN", message: "Your account is not currently mapped to a CVC franchise." });
    const existing = unwrap(await supabase.from("watchlist").select("id").eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle());
    if (existing) {
      unwrap(await supabase.from("watchlist").delete().eq("id", existing.id).select("id").single());
      return { watching: false };
    }
    unwrap(await supabase.from("watchlist").insert({ franchise_id: franchise.id, player_id: input.playerId }).select("id").single());
    return { watching: true };
  }),

  waiverBidQueue: protectedProcedure.query(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    const periodIds = (unwrap(await supabase.from("waiver_period").select("id").eq("season_id", season.id)) ?? []).map(period => period.id);
    if (!periodIds.length) return [];
    return unwrap(await supabase.from("faab_bid").select("id, amount, priority, max_players_desired, status, submitted_at, player:player_id(id, display_name, position, nfl_team), franchise:franchise_id(id, name), period:waiver_period_id(id, label, closes_at, status)").in("waiver_period_id", periodIds).eq("status", "pending").order("amount", { ascending: false }).order("priority").limit(200)) ?? [];
  }),

  // Automated resolution runs via the Thursday/Sunday 9am cron (see
  // server/_core/vercelScheduledWaiverResolution.ts); this is a manual backup/testing
  // trigger for the commissioner, using the exact same engine, so "run it early" or "the
  // cron didn't fire, run it now" never requires a code change.
  runWaiverResolution: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const result = await resolveOpenWaiverPeriod();
    if (!result) return { resolved: false as const, message: "No CVC waiver period is currently past its close time." };
    return { resolved: true as const, ...result };
  }),

  // Manual single-bid override for the commissioner (e.g. correcting a mistaken
  // automated result, or awarding something outside the normal cycle). Performs the
  // exact same award steps as the automated Thursday/Sunday engine
  // (resolveOpenWaiverPeriod in waiverResolution.ts) -- contract at the bid salary,
  // acquired_via/locked_until on the roster assignment -- rather than the old version of
  // this endpoint, which only created a bare roster_assignment with no contract at all.
  resolveFaabBid: protectedProcedure.input(z.object({ bidId: z.string().uuid(), outcome: z.enum(["won", "lost"]) })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const bid = unwrap(await supabase.from("faab_bid").select("id, waiver_period_id, franchise_id, player_id, drop_player_id, amount, status, player:player_id(display_name), franchise:franchise_id(name)").eq("id", input.bidId).maybeSingle());
    if (!bid) throw new TRPCError({ code: "NOT_FOUND", message: "CVC waiver bid was not found." });
    if (bid.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending CVC waiver bids may be resolved." });
    if (input.outcome === "won") {
      const active = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", bid.player_id).is("released_at", null).limit(1).maybeSingle());
      if (active) throw new TRPCError({ code: "BAD_REQUEST", message: "This player is no longer available for a CVC waiver award." });
      const rosterRows = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", bid.franchise_id).is("released_at", null)) ?? [];
      if (rosterRows.length - (bid.drop_player_id ? 1 : 0) + 1 > MAX_ROSTER_SIZE) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Awarding this player would put ${bid.franchise?.[0]?.name ?? "this franchise"} over the ${MAX_ROSTER_SIZE}-player CVC roster limit.` });
      }
      const now = new Date().toISOString();
      if (bid.drop_player_id) {
        unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now }).eq("season_id", season.id).eq("franchise_id", bid.franchise_id).eq("player_id", bid.drop_player_id).is("released_at", null).select("id"));
        unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", season.id).eq("franchise_id", bid.franchise_id).eq("player_id", bid.drop_player_id).select("id"));
      }
      const period = unwrap(await supabase.from("waiver_period").select("closes_at").eq("id", bid.waiver_period_id).maybeSingle());
      const lockedUntil = computeNextResolutionTime(period?.closes_at ? new Date(period.closes_at) : new Date()).toISOString();
      unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: bid.franchise_id, player_id: bid.player_id, roster_state: "bench", acquired_via: "waiver_bid", locked_until: lockedUntil }).select("id").single());
      unwrap(await supabase.from("player_contract").upsert({ season_id: season.id, franchise_id: bid.franchise_id, player_id: bid.player_id, salary: bid.amount, expires_year: season.year, source_marker: "W", contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
      unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: now }).eq("waiver_period_id", bid.waiver_period_id).eq("player_id", bid.player_id).eq("status", "pending").neq("id", bid.id).select("id"));
      unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: bid.franchise_id, actor_owner_id: commissioner.id, transaction_type: "waiver", status: "final", summary: `${bid.franchise?.[0]?.name ?? "CVC franchise"} won ${bid.player?.[0]?.display_name ?? "a player"} for $${bid.amount} FAAB`, details: { faab_bid_id: bid.id, player_id: bid.player_id, amount: bid.amount } }).select("id").single());
    }
    const resolved = unwrap(await supabase.from("faab_bid").update({ status: input.outcome, resolved_at: new Date().toISOString() }).eq("id", bid.id).select("id, status").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "faab_bid", bid.id, input.outcome, `Resolved waiver bid as ${input.outcome}`);
    return resolved;
  }),

  myTrades: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const { season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise && !["commissioner", "administrator"].includes(owner.role)) return [];
    let query = supabase.from("trade_offer").select("id, status, note, proposed_at, responded_at, reviewed_at, proposer:proposer_franchise_id(id, name), recipient:recipient_franchise_id(id, name), assets:trade_asset(id, from_franchise_id, player:player_id(id, display_name, position, nfl_team), pick:draft_pick_id(id, round_number, pick_number, draft:draft_id(draft_type, season:season_id(year))))").eq("season_id", season.id).order("proposed_at", { ascending: false }).limit(100);
    if (franchise) query = query.or(`proposer_franchise_id.eq.${franchise.id},recipient_franchise_id.eq.${franchise.id}`);
    return unwrap(await query) ?? [];
  }),

  proposeTrade: protectedProcedure.input(z.object({
    recipientFranchiseId: z.string().uuid(),
    offerPlayerIds: z.array(z.string().uuid()).max(22).default([]),
    requestPlayerIds: z.array(z.string().uuid()).max(22).default([]),
    offerPickIds: z.array(z.string().uuid()).max(10).default([]),
    requestPickIds: z.array(z.string().uuid()).max(10).default([]),
    note: z.string().trim().max(500).optional(),
  })
    .refine(value => value.offerPlayerIds.length + value.offerPickIds.length > 0, { message: "Include at least one player or pick in what you're offering." })
    .refine(value => value.requestPlayerIds.length + value.requestPickIds.length > 0, { message: "Include at least one player or pick in what you're requesting." })
    .refine(value => new Set([...value.offerPlayerIds, ...value.requestPlayerIds]).size === value.offerPlayerIds.length + value.requestPlayerIds.length, { message: "A player may appear only once in a CVC trade proposal." })
    .refine(value => new Set([...value.offerPickIds, ...value.requestPickIds]).size === value.offerPickIds.length + value.requestPickIds.length, { message: "A draft pick may appear only once in a CVC trade proposal." }))
    .mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to propose a trade." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const proposer = unwrap(await supabase.from("franchise").select("id, name").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!proposer) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner with an active CVC franchise may propose a trade." });
    if (proposer.id === input.recipientFranchiseId) throw new TRPCError({ code: "BAD_REQUEST", message: "A CVC franchise cannot propose a trade to itself." });
    const recipient = unwrap(await supabase.from("franchise").select("id, name").eq("id", input.recipientFranchiseId).eq("is_active", true).maybeSingle());
    if (!recipient) throw new TRPCError({ code: "NOT_FOUND", message: "The recipient CVC franchise was not found." });
    const playerIds = [...input.offerPlayerIds, ...input.requestPlayerIds];
    const assignments = playerIds.length ? unwrap(await supabase.from("roster_assignment").select("player_id, franchise_id").eq("season_id", season.id).in("player_id", playerIds).is("released_at", null)) ?? [] : [];
    const ownerByPlayer = new Map(assignments.map(assignment => [assignment.player_id, assignment.franchise_id]));
    if (input.offerPlayerIds.some(playerId => ownerByPlayer.get(playerId) !== proposer.id) || input.requestPlayerIds.some(playerId => ownerByPlayer.get(playerId) !== recipient.id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every CVC trade player must be on the franchise offering that player." });
    const pickIds = [...input.offerPickIds, ...input.requestPickIds];
    const pickRows = pickIds.length ? unwrap(await supabase.from("draft_pick").select("id, current_franchise_id, pick_status, round_number, pick_number, draft:draft_id(status, season:season_id(year))").in("id", pickIds)) ?? [] : [];
    const pickById = new Map(pickRows.map(pick => [pick.id, pick]));
    if (pickIds.some(pickId => !pickById.has(pickId))) throw new TRPCError({ code: "NOT_FOUND", message: "One or more CVC draft picks were not found." });
    if (pickIds.some(pickId => pickById.get(pickId)!.pick_status !== "open")) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open, unselected CVC draft pick may be traded." });
    // CVC trades only ever include: this year's picks (while that draft hasn't happened
    // yet -- once complete, even a leftover 'open' pick from a data quirk shouldn't be
    // tradeable) or next year's picks. Nothing further out.
    for (const pickId of pickIds) {
      const pick = pickById.get(pickId)!;
      const draftRow = pick.draft?.[0];
      const pickYear = draftRow?.season?.[0]?.year;
      if (pickYear == null || (pickYear !== season.year && pickYear !== season.year + 1)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only ${season.year} and ${season.year + 1} CVC draft picks may be traded.` });
      }
      if (pickYear === season.year && draftRow?.status === "complete") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `The ${season.year} CVC draft has already been completed, so its picks can no longer be traded.` });
      }
    }
    if (input.offerPickIds.some(pickId => pickById.get(pickId)!.current_franchise_id !== proposer.id) || input.requestPickIds.some(pickId => pickById.get(pickId)!.current_franchise_id !== recipient.id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every CVC trade pick must currently be owned by the franchise offering that pick." });
    const trade = unwrap(await supabase.from("trade_offer").insert({ season_id: season.id, proposer_franchise_id: proposer.id, recipient_franchise_id: recipient.id, note: input.note ?? null }).select("id").single());
    if (!trade) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC trade proposal could not be saved." });
    const assets = [
      ...input.offerPlayerIds.map(player_id => ({ trade_offer_id: trade.id, from_franchise_id: proposer.id, player_id })),
      ...input.requestPlayerIds.map(player_id => ({ trade_offer_id: trade.id, from_franchise_id: recipient.id, player_id })),
      ...input.offerPickIds.map(draft_pick_id => ({ trade_offer_id: trade.id, from_franchise_id: proposer.id, draft_pick_id })),
      ...input.requestPickIds.map(draft_pick_id => ({ trade_offer_id: trade.id, from_franchise_id: recipient.id, draft_pick_id })),
    ];
    unwrap(await supabase.from("trade_asset").insert(assets).select("id"));
    await createAuditEvent(league.id, season.id, owner.id, "trade_offer", trade.id, "proposed", `${proposer.name} proposed a trade to ${recipient.name}.`);
    return { tradeId: trade.id };
  }),

  respondToTrade: protectedProcedure.input(z.object({ tradeId: z.string().uuid(), response: z.enum(["accepted", "rejected", "cancelled"]) })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    const trade = unwrap(await supabase.from("trade_offer").select("id, proposer_franchise_id, recipient_franchise_id, status").eq("id", input.tradeId).eq("season_id", season.id).maybeSingle());
    if (!franchise || !trade) throw new TRPCError({ code: "NOT_FOUND", message: "CVC trade proposal was not found for this owner." });
    const isRecipient = trade.recipient_franchise_id === franchise.id; const isProposer = trade.proposer_franchise_id === franchise.id;
    if (trade.status !== "proposed" || (input.response === "accepted" || input.response === "rejected" ? !isRecipient : !isProposer)) throw new TRPCError({ code: "FORBIDDEN", message: "This CVC trade response is not available." });
    if (input.response !== "accepted") {
      const updated = unwrap(await supabase.from("trade_offer").update({ status: input.response, responded_at: new Date().toISOString() }).eq("id", trade.id).select("id, status").single());
      await createAuditEvent(league.id, season.id, owner.id, "trade_offer", trade.id, input.response, `CVC trade proposal was ${input.response}.`);
      return updated;
    }
    // No commissioner approval step: once the recipient accepts, the trade executes
    // immediately -- both sides already agreed, so there's nothing left to approve.
    unwrap(await supabase.from("trade_offer").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", trade.id).select("id").single());
    await executeAcceptedTrade(trade.id, season, owner.id, "Both franchises agreed to this CVC trade; it processed automatically.");
    const finalTrade = unwrap(await supabase.from("trade_offer").select("id, status").eq("id", trade.id).single());
    return finalTrade;
  }),

  executeTrade: protectedProcedure.input(z.object({ tradeId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    // Manual backup/re-run tool only -- trades no longer require this step normally
    // (respondToTrade executes automatically on acceptance). Kept for edge cases, e.g.
    // a trade stuck at 'accepted' from before this change, or retrying after a
    // transient failure.
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    await executeAcceptedTrade(input.tradeId, season, commissioner.id, "Commissioner manually re-ran CVC trade execution.");
    return { processed: true };
  }),

  myFranchise: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Your account is not associated with a CVC owner record." });
    const franchise = unwrap(await supabase.from("franchise").select("id, name, abbreviation, division_name, logo_url").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "No active CVC franchise is assigned to your owner record." });
    return franchise;
  }),

  access: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    return {
      isLeagueOwner: Boolean(owner),
      isCommissioner: owner ? ["commissioner", "administrator"].includes(owner.role) : false,
      role: owner?.role ?? null,
      displayName: owner?.display_name ?? null,
    };
  }),

  rosterSlots: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    return unwrap(await supabase.from("roster_slot").select("id, code, label, eligible_positions, slot_group, minimum_count, maximum_count, display_order").eq("season_id", season.id).order("display_order").order("code")) ?? [];
  }),

  scoringRules: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    return unwrap(await supabase.from("scoring_rule").select("category, stat_key, label, value, applies_to_positions").eq("season_id", season.id).order("category").order("stat_key")) ?? [];
  }),

  liveScoringBoard: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number, label, status").eq("season_id", season.id).order("week_number")) ?? [];
    const week = weeks.find(item => item.status === "live") ?? weeks.find(item => item.status === "upcoming") ?? null;
    if (!week) return { week: null, matchups: [] };
    const matchups = unwrap(await supabase.from("matchup").select("id, home_franchise_id, away_franchise_id, home_score, away_score, result_state, home:home_franchise_id(id, name, logo_url), away:away_franchise_id(id, name, logo_url)").eq("schedule_week_id", week.id).order("created_at")) ?? [];
    const franchiseIds = Array.from(new Set(matchups.flatMap(item => [item.home_franchise_id, item.away_franchise_id])));
    const assignments = franchiseIds.length ? unwrap(await supabase.from("roster_assignment").select("id, franchise_id, assigned_slot_code, player:player_id(id, display_name, position, nfl_team)").eq("season_id", season.id).in("franchise_id", franchiseIds).is("released_at", null).not("assigned_slot_code", "is", null)) ?? [] : [];
    const lineupFor = (franchiseId: string) => activeLiveLineup(assignments, franchiseId);
    const franchise = (value: unknown) => Array.isArray(value) ? value[0] as { name?: string; logo_url?: string | null } | undefined : value as { name?: string; logo_url?: string | null } | null;
    return {
      week: { weekNumber: week.week_number, label: week.label, status: week.status },
      matchups: matchups.map(item => ({
        id: item.id,
        home: franchise(item.home)?.name ?? "Home", away: franchise(item.away)?.name ?? "Away",
        homeFranchiseId: item.home_franchise_id, awayFranchiseId: item.away_franchise_id,
        homeLogoUrl: franchise(item.home)?.logo_url ?? null, awayLogoUrl: franchise(item.away)?.logo_url ?? null,
        homeScore: item.home_score, awayScore: item.away_score, resultState: item.result_state,
        homeLineup: lineupFor(item.home_franchise_id), awayLineup: lineupFor(item.away_franchise_id),
      })),
    };
  }),

  setLineupSlot: protectedProcedure.input(z.object({ assignmentId: z.string().uuid(), slotCode: z.string().trim().min(1).max(40) })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to update a lineup." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const assignment = unwrap(await supabase.from("roster_assignment").select("id, franchise_id, player_id, assigned_slot_code, player:player_id(display_name, position)").eq("id", input.assignmentId).eq("season_id", season.id).is("released_at", null).maybeSingle());
    if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "CVC roster assignment was not found." });
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", assignment.franchise_id).maybeSingle());
    if (!franchise || (franchise.current_owner_id !== owner.id && !["commissioner", "administrator"].includes(owner.role))) throw new TRPCError({ code: "FORBIDDEN", message: "You may only update your own CVC franchise lineup." });
    const player = assignment.player?.[0];
    // BENCH is a real configured roster_slot row (eligible for every position), not
    // represented by a null assigned_slot_code -- confirmed against the actual
    // roster_slot table. It goes through the exact same lookup/eligibility/capacity
    // checks as any other slot below.
    const slot = unwrap(await supabase.from("roster_slot").select("code, label, eligible_positions, maximum_count").eq("season_id", season.id).eq("code", input.slotCode).maybeSingle());
    if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "That CVC roster slot is not configured for this season." });
    if (slot.eligible_positions?.length && player?.position && !slot.eligible_positions.includes(player.position)) throw new TRPCError({ code: "BAD_REQUEST", message: `${player.position} is not eligible for the ${slot.label} CVC roster slot.` });
    const occupied = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", assignment.franchise_id).eq("assigned_slot_code", slot.code).is("released_at", null).neq("id", assignment.id)) ?? [];
    if (occupied.length >= slot.maximum_count) throw new TRPCError({ code: "BAD_REQUEST", message: `The ${slot.label} CVC roster slot is already at capacity.` });
    unwrap(await supabase.from("roster_assignment").update({ assigned_slot_code: slot.code, updated_at: new Date().toISOString() }).eq("id", assignment.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: owner.id, transaction_type: "lineup_move", status: "final", summary: `${franchise.name} assigned ${player?.display_name ?? "a player"} to ${slot.label}.`, details: { roster_assignment_id: assignment.id, previous_slot: assignment.assigned_slot_code, slot_code: slot.code } }).select("id").single());
    await createAuditEvent(league.id, season.id, owner.id, "roster_assignment", assignment.id, "lineup_slot_updated", `${franchise.name} assigned ${player?.display_name ?? "a player"} to ${slot.label}.`);
    return { assignmentId: assignment.id, slotCode: slot.code };
  }),

  cutContractPlayer: protectedProcedure.input(z.object({
    franchiseId: z.string().uuid(),
    playerId: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to release a player." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    if (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You may only release players from your own CVC franchise." });
    }
    const assignment = unwrap(await supabase.from("roster_assignment").select("id, locked_until").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle());
    if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "This player is not on the active CVC roster." });
    if (assignment.locked_until && new Date(assignment.locked_until).getTime() > Date.now()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `This player was just acquired via waivers and can't be cut until the next waiver resolution (${new Date(assignment.locked_until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}).` });
    }
    const contract = unwrap(await supabase.from("player_contract").select("id, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle());
    if (!contract || ["released", "expired"].includes(contract.contract_status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active CVC contract can be released from Protections." });
    }
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle());
    const activeRights = unwrap(await supabase.from("player_right").select("right_type").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active")) ?? [];
    const cutTagType = activeRights.find(right => right.right_type === "rookie_match" || right.right_type === "waiver_match")?.right_type as "rookie_match" | "waiver_match" | undefined;

    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", assignment.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: "released", last_cut_by_franchise_id: cutTagType ? franchise.id : null, last_cut_tag_type: cutTagType ?? null }).eq("id", contract.id).select("id").single());
    unwrap(await supabase.from("player_right").update({ status: "revoked" }).eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active").select("id"));
    unwrap(await supabase.from("transaction").insert({
      season_id: season.id,
      franchise_id: franchise.id,
      actor_owner_id: actor.id,
      transaction_type: "drop",
      status: "final",
      summary: `${franchise.name} released ${player?.display_name ?? "a player"} with no contract penalty.`,
      details: { player_id: input.playerId, release_source: "protections", no_penalty: true },
    }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_contract", contract.id, "released", `${franchise.name} released ${player?.display_name ?? "a player"} from an active contract with no penalty.`);
    return { released: true, playerId: input.playerId };
  }),

  assignFranchiseTag: protectedProcedure.input(z.object({
    franchiseId: z.string().uuid(),
    playerId: z.string().uuid(),
    contractYears: z.union([z.literal(2), z.literal(3)]),
  })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to assign a franchise tag." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    if (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You may only assign a franchise tag for your own CVC franchise." });
    const [assignment, contract, player, activeRights, franchiseTags, priorTransition] = await Promise.all([
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle(),
      supabase.from("player_contract").select("id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("player_right").select("id, right_type").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active"),
      supabase.from("player_right").select("player_id, salary_basis, metadata").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("right_type", "franchise").eq("status", "active"),
      supabase.from("player_right").select("salary_basis, metadata").eq("player_id", input.playerId).eq("right_type", "transition").limit(10),
    ]);
    const activeAssignment = unwrap(assignment); const activeContract = unwrap(contract); const playerRow = unwrap(player);
    const existingRights = unwrap(activeRights) ?? []; const existingFranchiseTags = unwrap(franchiseTags) ?? [];
    if (!activeAssignment || !activeContract || ["released", "expired"].includes(activeContract.contract_status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active rostered contract can receive a franchise tag." });
    if (!isCvcProtectionYear(activeContract.expires_year, season.year)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only contracts expiring in 2026 may receive a CVC protection designation. 2027 and 2028 contracts may only be cut." });
    if (existingRights.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Remove or resolve the player’s current protection right before assigning a franchise tag." });
    const priorTransitions = unwrap(priorTransition) ?? [];
    if (priorTransitions.some(isCvcHighSalaryTransition)) throw new TRPCError({ code: "BAD_REQUEST", message: "A player transitioned from a three-year / $10-and-over contract cannot later be franchised under CVC rules." });
    const currentSalary = Number(activeContract.salary);
    const salary = currentSalary;
    const termTier = cvcContractTier(currentSalary, activeContract.source_marker);
    const requiredYears = cvcFranchiseTerms(termTier);
    if (input.contractYears !== requiredYears) throw new TRPCError({ code: "BAD_REQUEST", message: `${termTier === "two_year" ? "Two-year" : "Three-year"} CVC contracts require a ${requiredYears}-year franchise term.` });
    if (existingFranchiseTags.some(tag => {
      const metadata = (tag.metadata ?? {}) as { tier?: string; term_tier?: "two_year" | "three_year" };
      const existingTier = metadata.term_tier ?? metadata.tier ?? cvcContractTier(Number(tag.salary_basis));
      return existingTier === termTier;
    })) throw new TRPCError({ code: "BAD_REQUEST", message: `This franchise already has its ${termTier === "two_year" ? "two-year" : "three-year"} franchise designation.` });
    const expiresYear = season.year + requiredYears - 1;
    unwrap(await supabase.from("player_contract").update({ salary, expires_year: expiresYear, source_marker: "F", contract_status: "active" }).eq("id", activeContract.id).select("id").single());
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: "franchise", salary_basis: currentSalary, contract_years: input.contractYears, expires_year: expiresYear, metadata: { term_tier: termTier, designated_season: season.year, tagged_salary: salary, re_franchise_allowed: true, transition_allowed_after_expiry: false, previous_salary: currentSalary, previous_expires_year: activeContract.expires_year, previous_source_marker: activeContract.source_marker, previous_contract_status: activeContract.contract_status } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the franchise designation." });
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} assigned a ${input.contractYears}-year franchise tag to ${playerRow?.display_name ?? "a player"}.`, details: { player_id: input.playerId, right_type: "franchise", term_tier: termTier, salary, contract_years: input.contractYears } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "franchise_tag_assigned", `${franchise.name} assigned a ${input.contractYears}-year ${termTier} franchise tag to ${playerRow?.display_name ?? "a player"}.`);
    return { rightId: right.id, salary, expiresYear };
  }),

  assignTransitionTag: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to assign a transition tag." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    if (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You may only assign a transition tag for your own CVC franchise." });
    const [assignment, contract, player, activeRights, priorTransition, priorFranchise] = await Promise.all([
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle(),
      supabase.from("player_contract").select("id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("player_right").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active"),
      supabase.from("player_right").select("id").eq("player_id", input.playerId).eq("right_type", "transition").limit(1),
      supabase.from("player_right").select("id").eq("player_id", input.playerId).eq("right_type", "franchise").limit(1),
    ]);
    const activeAssignment = unwrap(assignment); const activeContract = unwrap(contract); const playerRow = unwrap(player);
    if (!activeAssignment || !activeContract || ["released", "expired"].includes(activeContract.contract_status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active rostered contract can receive a transition tag." });
    if (!isCvcProtectionYear(activeContract.expires_year, season.year)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only contracts expiring in 2026 may receive a CVC protection designation. 2027 and 2028 contracts may only be cut." });
    if ((unwrap(activeRights) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Remove or resolve the player’s current protection right before assigning a transition tag." });
    if ((unwrap(priorTransition) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "This player has already used a transition designation and cannot be transitioned again." });
    if ((unwrap(priorFranchise) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "A player who has been franchised may be re-franchised after expiry but may not be transitioned." });
    const currentSalary = Number(activeContract.salary); const priorSeasonSalary = cvcPriorSeasonSalary(currentSalary); const transitionTier = cvcContractTier(priorSeasonSalary, activeContract.source_marker); const salary = cvcTransitionSalary(priorSeasonSalary, transitionTier);
    // A transition tag extends the contract one year beyond the season it's applied in
    // (e.g. applied during the 2026 season -> runs through 2027), the same way
    // assignFranchiseTag computes expiresYear = season.year + years - 1 for its own
    // term. Previously this was hardcoded to season.year itself, which incorrectly
    // treated the tag as expiring immediately in the same season it was applied, and
    // marked contract_status "expiring" even though the tag had just extended it.
    const expiresYear = season.year + 1;
    unwrap(await supabase.from("player_contract").update({ salary, expires_year: expiresYear, source_marker: "T", contract_status: "active" }).eq("id", activeContract.id).select("id").single());
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: "transition", salary_basis: priorSeasonSalary, contract_years: 1, expires_year: expiresYear, metadata: { transition_exhausted: true, transition_tier: transitionTier, designated_season: season.year, prior_season_salary: priorSeasonSalary, tagged_salary: salary, future_franchise_allowed: transitionTier === "two_year", previous_salary: currentSalary, previous_expires_year: activeContract.expires_year, previous_source_marker: activeContract.source_marker, previous_contract_status: activeContract.contract_status } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the transition designation." });
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} assigned a transition tag to ${playerRow?.display_name ?? "a player"}.`, details: { player_id: input.playerId, right_type: "transition", salary } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "transition_tag_assigned", `${franchise.name} assigned a one-year transition tag to ${playerRow?.display_name ?? "a player"}.`);
    return { rightId: right.id, salary, expiresYear };
  }),

  assignRestrictedRight: protectedProcedure.input(z.object({
    franchiseId: z.string().uuid(),
    playerId: z.string().uuid(),
    rightType: z.enum(["rookie_match", "waiver_match"]),
    waiverEligibilityOverride: z.boolean().optional().default(false),
  })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to assign a restricted right." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    if (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You may only assign restricted rights for your own CVC franchise." });
    const [assignment, contract, player, activeRights, waiverRights, waiverTransactions] = await Promise.all([
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle(),
      supabase.from("player_contract").select("id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("player_right").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active"),
      supabase.from("player_right").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("right_type", "waiver_match").eq("status", "active"),
      supabase.from("transaction").select("details").eq("franchise_id", franchise.id).in("transaction_type", ["waiver", "add"]).limit(500),
    ]);
    const activeAssignment = unwrap(assignment); const activeContract = unwrap(contract); const playerRow = unwrap(player);
    if (!activeAssignment || !activeContract) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a current CVC roster player can receive a restricted right." });
    if ((unwrap(activeRights) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Remove or resolve the player’s current protection right before assigning a restricted right." });
    const marker = (activeContract.source_marker ?? "").toUpperCase();
    if (input.rightType === "rookie_match" && !marker.includes("R")) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a rookie-marked CVC contract is eligible for a rookie matching right." });
    if (input.rightType === "waiver_match" && !marker.includes("W")) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a waiver-marked CVC contract is eligible for a waiver matching right." });
    if (activeContract.expires_year === null || activeContract.expires_year > season.year) throw new TRPCError({ code: "BAD_REQUEST", message: "Restricted rights can only be assigned after the player’s current contract has expired." });
    const wasWaiverAcquired = (unwrap(waiverTransactions) ?? []).some(transaction => (transaction.details as { player_id?: string } | null)?.player_id === input.playerId);
    const isCommissioner = ["commissioner", "administrator"].includes(actor.role);
    if (input.waiverEligibilityOverride && !isCommissioner) throw new TRPCError({ code: "FORBIDDEN", message: "Only a CVC commissioner may approve legacy waiver eligibility." });
    if (input.rightType === "waiver_match" && marker !== "W" && !wasWaiverAcquired && !input.waiverEligibilityOverride) throw new TRPCError({ code: "BAD_REQUEST", message: "A waiver matching right requires a recorded CVC waiver or free-agent acquisition, or commissioner-reviewed legacy eligibility." });
    if (input.rightType === "waiver_match" && (unwrap(waiverRights) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Each franchise may hold one active waiver matching right per season." });
    const waiverEligibilitySource = wasWaiverAcquired ? "recorded_transaction" : input.waiverEligibilityOverride ? "commissioner_review" : null;
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: input.rightType, salary_basis: Number(activeContract.salary), expires_year: activeContract.expires_year ?? season.year, metadata: { original_franchise_id: franchise.id, designated_season: season.year, source_marker: activeContract.source_marker, waiver_eligibility_source: waiverEligibilitySource } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the restricted right." });
    // A restricted right makes the player a restricted-rights free agent, not a rostered
    // player: release them to the auction/free-agent pool, tagged with the rights-holding
    // franchise (reusing the same cut-tag columns/UI as a manual cut with an active right).
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", activeAssignment.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: "released", last_cut_by_franchise_id: franchise.id, last_cut_tag_type: input.rightType }).eq("id", activeContract.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} designated ${playerRow?.display_name ?? "a player"} for ${input.rightType === "rookie_match" ? "rookie" : "waiver"} matching rights.`, details: { player_id: input.playerId, right_type: input.rightType } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "restricted_right_assigned", `${franchise.name} assigned ${input.rightType} to ${playerRow?.display_name ?? "a player"} and released them to the CVC restricted-rights free-agent pool.`);
    return { rightId: right.id, rightType: input.rightType };
  }),

  // Shows which of the calling owner's current roster players are eligible for the
  // one-per-season restricted-rights designation (assignRestrictedRight, above): a
  // waiver-acquired ('W' marked) contract whose expires_year has reached this season.
  // Pure convenience query -- assignRestrictedRight already enforces the real
  // eligibility rules itself; this just saves an owner from hunting through their roster.
  myWaiverEligiblePlayers: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required." });
    const franchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) return [];
    const { season } = await getCurrentLeagueAndSeason();
    const contracts = unwrap(await supabase.from("player_contract").select("player_id, salary, expires_year, source_marker, player:player_id(id, display_name, position, nfl_team)").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("contract_status", "active").eq("source_marker", "W").lte("expires_year", season.year)) ?? [];
    const activeRoster = new Set((unwrap(await supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).eq("franchise_id", franchise.id).is("released_at", null)) ?? []).map(row => row.player_id));
    return contracts.filter(row => activeRoster.has(row.player_id));
  }),

  // The default outcome of rule #2 (every waiver-acquired contract terminates at
  // season's end): releases every remaining active 'W'-marked, expired-this-season
  // contract that ISN'T already covered by an active waiver_match player_right (i.e.
  // wasn't the one player each owner chose to protect via assignRestrictedRight -- run
  // that first, per franchise, before running this sweep). No rights are created here;
  // this is purely the "terminate" half of the rule.
  terminateExpiredWaiverContracts: protectedProcedure.mutation(async ({ ctx }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const contracts = unwrap(await supabase.from("player_contract").select("id, franchise_id, player_id, player:player_id(display_name), franchise:franchise_id(name)").eq("season_id", season.id).eq("contract_status", "active").eq("source_marker", "W").lte("expires_year", season.year)) ?? [];
    const protectedPairs = new Set((unwrap(await supabase.from("player_right").select("franchise_id, player_id").eq("season_id", season.id).eq("right_type", "waiver_match").eq("status", "active")) ?? []).map(row => `${row.franchise_id}:${row.player_id}`));
    const now = new Date().toISOString();
    const terminated: { playerName: string; franchiseName: string }[] = [];
    for (const contract of contracts) {
      if (protectedPairs.has(`${contract.franchise_id}:${contract.player_id}`)) continue;
      unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now }).eq("season_id", season.id).eq("franchise_id", contract.franchise_id).eq("player_id", contract.player_id).is("released_at", null).select("id"));
      unwrap(await supabase.from("player_contract").update({ contract_status: "expired" }).eq("id", contract.id).select("id").single());
      const playerName = contract.player?.[0]?.display_name ?? "Unknown player";
      const franchiseName = contract.franchise?.[0]?.name ?? "Unknown franchise";
      unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: contract.franchise_id, actor_owner_id: commissioner.id, transaction_type: "note", status: "final", summary: `${franchiseName}'s waiver-acquired contract for ${playerName} terminated at season's end.`, details: { player_id: contract.player_id } }).select("id").single());
      terminated.push({ playerName, franchiseName });
    }
    await createAuditEvent(league.id, season.id, commissioner.id, "player_contract", null, "waiver_contracts_terminated", `Terminated ${terminated.length} expired waiver contract(s) at season's end.`);
    return { terminated };
  }),

  undoProtection: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), rightId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to undo a protection." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise || (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role))) throw new TRPCError({ code: "FORBIDDEN", message: "You may only undo protections for your own CVC franchise." });
    const right = unwrap(await supabase.from("player_right").select("id, player_id, right_type, salary_basis, metadata").eq("id", input.rightId).eq("season_id", season.id).eq("franchise_id", franchise.id).eq("status", "active").maybeSingle());
    if (!right || !["franchise", "transition", "rookie_match", "waiver_match"].includes(right.right_type)) throw new TRPCError({ code: "NOT_FOUND", message: "That active CVC protection decision is not available to undo." });
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", right.player_id).maybeSingle());
    if (["franchise", "transition"].includes(right.right_type)) {
      const metadata = (right.metadata ?? {}) as { previous_salary?: number; previous_expires_year?: number; previous_source_marker?: string | null; previous_contract_status?: string };
      const contract = unwrap(await supabase.from("player_contract").select("id, salary, source_marker").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", right.player_id).maybeSingle());
      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "The CVC contract tied to this protection could not be found." });
      const inferredPreviousSalary = right.right_type === "transition" ? Number(right.salary_basis ?? contract.salary) + 1 : Number(right.salary_basis ?? contract.salary);
      unwrap(await supabase.from("player_contract").update({ salary: metadata.previous_salary ?? inferredPreviousSalary, expires_year: metadata.previous_expires_year ?? season.year, source_marker: metadata.previous_source_marker ?? contract.source_marker ?? "W", contract_status: metadata.previous_contract_status ?? "expiring" }).eq("id", contract.id).select("id").single());
    }
    unwrap(await supabase.from("player_right").update({ status: "revoked" }).eq("id", right.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} undid the ${right.right_type.replaceAll("_", " ")} protection for ${player?.display_name ?? "a player"}.`, details: { player_id: right.player_id, right_id: right.id, action: "protection_undone" } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "protection_undone", `${franchise.name} undid ${right.right_type} for ${player?.display_name ?? "a player"}.`);
    return { undone: true };
  }),

  restoreCutPlayer: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to restore a cut player." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise || (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role))) throw new TRPCError({ code: "FORBIDDEN", message: "You may only restore players for your own CVC franchise." });
    const assignment = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).not("released_at", "is", null).order("released_at", { ascending: false }).limit(1).maybeSingle());
    const contract = unwrap(await supabase.from("player_contract").select("id, expires_year").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("contract_status", "released").maybeSingle());
    if (!assignment || !contract) throw new TRPCError({ code: "NOT_FOUND", message: "That CVC cut player is not available to restore." });
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle());
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "active", released_at: null, updated_at: new Date().toISOString() }).eq("id", assignment.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: Number(contract.expires_year) <= season.year ? "expiring" : "active", last_cut_by_franchise_id: null, last_cut_tag_type: null }).eq("id", contract.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "add", status: "final", summary: `${franchise.name} restored ${player?.display_name ?? "a player"} from Protections.`, details: { player_id: input.playerId, action: "cut_restored" } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "roster_assignment", assignment.id, "cut_restored", `${franchise.name} restored ${player?.display_name ?? "a player"} from Protections.`);
    return { restored: true };
  }),

  runAutoCutSweep: protectedProcedure.mutation(async ({ ctx }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const assignments = unwrap(await supabase.from("roster_assignment").select("id, franchise_id, player_id").eq("season_id", season.id).is("released_at", null)) ?? [];
    if (!assignments.length) return { flaggedCount: 0, flagged: [] as { franchiseId: string; franchiseName: string; playerId: string; playerName: string }[] };
    const playerIds = Array.from(new Set(assignments.map(assignment => assignment.player_id)));
    const [contracts, activeRights, activeFranchises] = await Promise.all([
      supabase.from("player_contract").select("id, franchise_id, player_id, expires_year, contract_status, pending_cut_flagged_at").eq("season_id", season.id).in("player_id", playerIds),
      supabase.from("player_right").select("franchise_id, player_id").eq("season_id", season.id).eq("status", "active").in("player_id", playerIds),
      supabase.from("franchise").select("id, name").eq("league_id", league.id).eq("is_active", true),
    ]);
    const contractByKey = new Map((unwrap(contracts) ?? []).map(contract => [`${contract.franchise_id}:${contract.player_id}`, contract]));
    const protectedKeys = new Set((unwrap(activeRights) ?? []).map(right => `${right.franchise_id}:${right.player_id}`));
    const franchiseNameById = new Map((unwrap(activeFranchises) ?? []).map(franchise => [franchise.id, franchise.name]));
    const targets = assignments
      .filter(assignment => franchiseNameById.has(assignment.franchise_id))
      .map(assignment => ({ assignment, contract: contractByKey.get(`${assignment.franchise_id}:${assignment.player_id}`) }))
      .filter((entry): entry is { assignment: typeof assignments[number]; contract: NonNullable<typeof entry.contract> } =>
        Boolean(entry.contract) &&
        !["released", "expired"].includes(entry.contract!.contract_status) &&
        isCvcProtectionYear(entry.contract!.expires_year, season.year) &&
        !entry.contract!.pending_cut_flagged_at &&
        !protectedKeys.has(`${entry.assignment.franchise_id}:${entry.assignment.player_id}`));
    if (!targets.length) return { flaggedCount: 0, flagged: [] as { franchiseId: string; franchiseName: string; playerId: string; playerName: string }[] };
    const players = unwrap(await supabase.from("player").select("id, display_name").in("id", targets.map(target => target.assignment.player_id))) ?? [];
    const playerNameById = new Map(players.map(player => [player.id, player.display_name]));
    const now = new Date().toISOString();
    const flagged: { franchiseId: string; franchiseName: string; playerId: string; playerName: string }[] = [];
    for (const { assignment, contract } of targets) {
      const franchiseName = franchiseNameById.get(assignment.franchise_id) ?? "a CVC franchise";
      const playerName = playerNameById.get(assignment.player_id) ?? "a player";
      unwrap(await supabase.from("player_contract").update({ pending_cut_flagged_at: now }).eq("id", contract.id).select("id").single());
      await createAuditEvent(league.id, season.id, commissioner.id, "player_contract", contract.id, "pending_cut_flagged", `${franchiseName} - ${playerName} flagged for CVC auto-cut review (unprotected expiring contract).`);
      flagged.push({ franchiseId: assignment.franchise_id, franchiseName, playerId: assignment.player_id, playerName });
    }
    return { flaggedCount: flagged.length, flagged };
  }),

  pendingCuts: protectedProcedure.query(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    const flaggedContracts = unwrap(await supabase.from("player_contract").select("id, franchise_id, player_id, salary, expires_year, pending_cut_flagged_at").eq("season_id", season.id).not("pending_cut_flagged_at", "is", null)) ?? [];
    if (!flaggedContracts.length) return [];
    const playerIds = Array.from(new Set(flaggedContracts.map(contract => contract.player_id)));
    const franchiseIds = Array.from(new Set(flaggedContracts.map(contract => contract.franchise_id)));
    const [assignments, activeRights, players, franchises] = await Promise.all([
      supabase.from("roster_assignment").select("franchise_id, player_id").eq("season_id", season.id).in("player_id", playerIds).is("released_at", null),
      supabase.from("player_right").select("franchise_id, player_id").eq("season_id", season.id).eq("status", "active").in("player_id", playerIds),
      supabase.from("player").select("id, display_name, position, nfl_team").in("id", playerIds),
      supabase.from("franchise").select("id, name").in("id", franchiseIds),
    ]);
    const activeAssignmentKeys = new Set((unwrap(assignments) ?? []).map(assignment => `${assignment.franchise_id}:${assignment.player_id}`));
    const protectedKeys = new Set((unwrap(activeRights) ?? []).map(right => `${right.franchise_id}:${right.player_id}`));
    const playerById = new Map((unwrap(players) ?? []).map(player => [player.id, player]));
    const franchiseById = new Map((unwrap(franchises) ?? []).map(franchise => [franchise.id, franchise]));
    return flaggedContracts
      .filter(contract => activeAssignmentKeys.has(`${contract.franchise_id}:${contract.player_id}`) && !protectedKeys.has(`${contract.franchise_id}:${contract.player_id}`))
      .map(contract => ({
        franchiseId: contract.franchise_id,
        franchiseName: franchiseById.get(contract.franchise_id)?.name ?? "Unknown franchise",
        playerId: contract.player_id,
        playerName: playerById.get(contract.player_id)?.display_name ?? "Unknown player",
        position: playerById.get(contract.player_id)?.position ?? null,
        nflTeam: playerById.get(contract.player_id)?.nfl_team ?? null,
        salary: Number(contract.salary ?? 0),
        expiresYear: contract.expires_year,
        flaggedAt: contract.pending_cut_flagged_at,
      }));
  }),

  processPendingCut: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const contract = unwrap(await supabase.from("player_contract").select("id, pending_cut_flagged_at").eq("season_id", season.id).eq("franchise_id", input.franchiseId).eq("player_id", input.playerId).maybeSingle());
    if (!contract || !contract.pending_cut_flagged_at) throw new TRPCError({ code: "NOT_FOUND", message: "This player is not on the CVC pending-cuts list." });
    const activeRight = unwrap(await supabase.from("player_right").select("id").eq("season_id", season.id).eq("franchise_id", input.franchiseId).eq("player_id", input.playerId).eq("status", "active").limit(1).maybeSingle());
    if (activeRight) {
      unwrap(await supabase.from("player_contract").update({ pending_cut_flagged_at: null }).eq("id", contract.id).select("id").single());
      throw new TRPCError({ code: "BAD_REQUEST", message: "This player now has an active CVC protection right and is no longer eligible for auto-cut; the pending flag has been cleared." });
    }
    const assignment = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", input.franchiseId).eq("player_id", input.playerId).is("released_at", null).maybeSingle());
    if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "This player is not on the active CVC roster." });
    const [franchise, player] = await Promise.all([
      supabase.from("franchise").select("name").eq("id", input.franchiseId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
    ]);
    const franchiseName = unwrap(franchise)?.name ?? "a CVC franchise";
    const playerName = unwrap(player)?.display_name ?? "a player";
    const now = new Date().toISOString();
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: now }).eq("id", assignment.id).select("id").single());
    // No cut-tag here: the guard above already rejects any player holding an active
    // player_right (including rookie_match/waiver_match), so this path never applies.
    unwrap(await supabase.from("player_contract").update({ contract_status: "released", pending_cut_flagged_at: null, last_cut_by_franchise_id: null, last_cut_tag_type: null }).eq("id", contract.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({
      season_id: season.id,
      franchise_id: input.franchiseId,
      actor_owner_id: commissioner.id,
      transaction_type: "drop",
      status: "final",
      summary: `Auto-cut: unprotected expiring contract — ${franchiseName} released ${playerName}.`,
      details: { player_id: input.playerId, roster_assignment_id: assignment.id, source: "auto_cut_sweep", reason: "unprotected_expiring_contract" },
    }).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "roster_assignment", assignment.id, "auto_cut_processed", `Auto-cut processed: ${franchiseName} released ${playerName}.`);
    return { processed: true };
  }),

  exemptPendingCut: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const contract = unwrap(await supabase.from("player_contract").select("id, pending_cut_flagged_at").eq("season_id", season.id).eq("franchise_id", input.franchiseId).eq("player_id", input.playerId).maybeSingle());
    if (!contract || !contract.pending_cut_flagged_at) throw new TRPCError({ code: "NOT_FOUND", message: "This player is not on the CVC pending-cuts list." });
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle());
    unwrap(await supabase.from("player_contract").update({ pending_cut_flagged_at: null }).eq("id", contract.id).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "player_contract", contract.id, "pending_cut_exempted", `Commissioner exempted ${player?.display_name ?? "a player"} from the CVC auto-cut pending list.`);
    return { exempted: true };
  }),

  saveFranchise: protectedProcedure.input(z.object({
    name: z.string().min(2).max(80),
    abbreviation: z.string().min(2).max(8).transform(value => value.toUpperCase()),
    divisionName: z.string().min(1).max(80).optional(),
    ownerId: z.string().uuid().optional(),
  })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const created = unwrap(await supabase.from("franchise").insert({
      league_id: league.id,
      name: input.name,
      abbreviation: input.abbreviation,
      division_name: input.divisionName ?? null,
      current_owner_id: input.ownerId ?? null,
    }).select("id, name, abbreviation").single());
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC franchise could not be created." });
    await createAuditEvent(league.id, season.id, commissioner.id, "franchise", created.id, "created", `Created franchise ${created.name}`);
    return created;
  }),

  saveOwner: protectedProcedure.input(z.object({
    displayName: z.string().min(2).max(120), email: z.string().email().optional(), role: z.enum(["owner", "commissioner", "administrator"]),
  })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const owner = unwrap(await supabase.from("owner").insert({ league_id: league.id, display_name: input.displayName, email: input.email ?? null, role: input.role }).select("id, display_name").single());
    if (!owner) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC owner could not be created." });
    await createAuditEvent(league.id, season.id, commissioner.id, "owner", owner.id, "created", `Created ${input.role} ${owner.display_name}`);
    return owner;
  }),

  saveScoringRule: protectedProcedure.input(z.object({
    category: z.string().min(2).max(80), statKey: z.string().min(2).max(120), label: z.string().min(2).max(120), value: z.number().finite(), positions: z.array(z.string().min(1).max(12)).max(12),
  })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const item = unwrap(await supabase.from("scoring_rule").insert({ season_id: season.id, category: input.category, stat_key: input.statKey, label: input.label, value: input.value, applies_to_positions: input.positions }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scoring rule could not be created." });
    await createAuditEvent(league.id, season.id, commissioner.id, "scoring_rule", item.id, "created", `Created scoring rule ${input.label}`); return item;
  }),

  saveRosterSlot: protectedProcedure.input(z.object({
    code: z.string().min(1).max(12), label: z.string().min(2).max(80), positions: z.array(z.string().min(1).max(12)).min(1).max(12), slotGroup: z.enum(["starter", "bench", "reserve", "injured_reserve", "taxi"]), minimum: z.number().int().min(0), maximum: z.number().int().min(0),
  }).refine(value => value.maximum >= value.minimum, { message: "Maximum must be at least minimum." })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const item = unwrap(await supabase.from("roster_slot").upsert({ season_id: season.id, code: input.code, label: input.label, eligible_positions: input.positions, slot_group: input.slotGroup, minimum_count: input.minimum, maximum_count: input.maximum }, { onConflict: "season_id,code" }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Roster slot could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "roster_slot", item.id, "saved", `Saved roster slot ${input.code}`); return item;
  }),

  saveScheduleWeek: protectedProcedure.input(z.object({ weekNumber: z.number().int().min(1).max(30), label: z.string().min(2).max(80), status: z.enum(["upcoming", "live", "final", "archived"]) })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const item = unwrap(await supabase.from("schedule_week").upsert({ season_id: season.id, week_number: input.weekNumber, label: input.label, status: input.status }, { onConflict: "season_id,week_number" }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Schedule week could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "schedule_week", item.id, "saved", `Saved ${input.label}`); return item;
  }),

  saveMatchup: protectedProcedure.input(matchupInputSchema).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const week = unwrap(await supabase.from("schedule_week").select("id, label").eq("season_id", season.id).eq("week_number", input.weekNumber).maybeSingle());
    if (!week) throw new TRPCError({ code: "BAD_REQUEST", message: "Save the CVC schedule week before adding its matchup." });
    const franchises = unwrap(await supabase.from("franchise").select("id, name").in("id", [input.homeFranchiseId, input.awayFranchiseId]).eq("league_id", league.id)) ?? [];
    if (franchises.length !== 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Both CVC franchises must exist before scheduling a matchup." });
    const item = unwrap(await supabase.from("matchup").upsert({ schedule_week_id: week.id, home_franchise_id: input.homeFranchiseId, away_franchise_id: input.awayFranchiseId, result_state: input.resultState }, { onConflict: "schedule_week_id,home_franchise_id" }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC matchup could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "matchup", item.id, "saved", `Saved ${week.label} matchup`); return item;
  }),

  saveRuleDocument: protectedProcedure.input(z.object({ title: z.string().min(2).max(120), slug: z.string().regex(/^[a-z0-9-]+$/), versionLabel: z.string().min(1).max(40), contentMarkdown: z.string().min(1).max(100000) })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const item = unwrap(await supabase.from("rule_document").upsert({ league_id: league.id, season_id: season.id, title: input.title, slug: input.slug, version_label: input.versionLabel, content_markdown: input.contentMarkdown, created_by_owner_id: commissioner.id }, { onConflict: "league_id,slug,version_label" }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Rule document could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "rule_document", item.id, "saved", `Saved rule document ${input.title}`); return item;
  }),

  saveFinancialEntry: protectedProcedure.input(z.object({ entryType: z.enum(["dues", "payout", "penalty", "credit", "adjustment"]), amount: z.number().finite(), status: z.enum(["open", "paid", "waived", "void"]), memo: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const item = unwrap(await supabase.from("league_financial_entry").insert({ season_id: season.id, entry_type: input.entryType, amount: input.amount, status: input.status, memo: input.memo ?? null }).select("id").single());
    if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Financial entry could not be saved." });
    await createAuditEvent(league.id, season.id, commissioner.id, "league_financial_entry", item.id, "created", `Created ${input.entryType} entry`); return item;
  }),
});
