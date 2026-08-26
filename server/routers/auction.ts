import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { supabase, unwrap } from "../supabase";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { cvcContractTier, cvcFranchiseTerms } from "../../shared/cvcProtectionPolicy";
import { fantasyProsCacheStatus } from "../fantasyProsCache";

export function calculateAuctionLegalMaxBid(startingBudget: number, spentBudget: number, rosterCount: number) {
  return startingBudget - spentBudget - Math.max(0, 14 - rosterCount);
}

const playerIdentity = (name: string | null | undefined) => (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const CVC_AUCTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST", "D/ST"] as const;
const isCvcAuctionPosition = (position: string | null | undefined) => CVC_AUCTION_POSITIONS.includes((position ?? "").toUpperCase() as typeof CVC_AUCTION_POSITIONS[number]);

async function context() {
  const season = unwrap(await supabase.from("season").select("id, league_id, year").order("year", { ascending: false }).limit(1).single());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
  const draft = unwrap(await supabase.from("draft").select("id, status, label").eq("season_id", season.id).eq("draft_type", "auction").limit(1).maybeSingle());
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC auction draft has not been configured." });
  return { season, draft };
}

// spent_budget/roster_count are never trusted from auction_team_state's own stored
// counters (see board query for the full explanation) — they only increment when
// award()/recordPick() runs, so any roster established outside that flow (CSV import,
// direct SQL corrections, trades) is invisible to them. Used here for the same legal-
// max-bid and roster-cap validation that award()/recordPick() perform before recording
// a pick, so a real, already-full/near-cap roster can't be silently over-committed.
async function liveTeamState(seasonId: string, draftId: string, franchiseId: string) {
  const state = unwrap(await supabase.from("auction_team_state").select("starting_budget").eq("draft_id", draftId).eq("franchise_id", franchiseId).maybeSingle());
  if (!state) return null;
  const [contractsResult, assignmentsResult] = await Promise.all([
    supabase.from("player_contract").select("salary").eq("season_id", seasonId).eq("franchise_id", franchiseId).eq("contract_status", "active"),
    supabase.from("roster_assignment").select("id").eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null),
  ]);
  const spent_budget = (unwrap(contractsResult) ?? []).reduce((sum, row) => sum + Number(row.salary), 0);
  const roster_count = (unwrap(assignmentsResult) ?? []).length;
  return { starting_budget: state.starting_budget, spent_budget, roster_count };
}
// Rookies are only auction-eligible once the rookie draft has concluded — the rookie
// draft runs first, and any rookie it doesn't select becomes fair game for the regular
// auction afterward. A selected rookie is already rostered by that point anyway (see
// recordDraftSelection), so this only ever matters for undrafted rookies.
async function assertRookieAuctionEligible(seasonId: string, isRookie: boolean) {
  if (!isRookie) return;
  const rookieDraft = unwrap(await supabase.from("draft").select("status").eq("season_id", seasonId).eq("draft_type", "rookie").maybeSingle());
  if (rookieDraft?.status !== "complete") throw new TRPCError({ code: "BAD_REQUEST", message: "Rookies are not eligible for the regular CVC auction until the rookie draft is complete." });
}
async function commissioner(openId: string) {
  const ownerId = openId.startsWith("cvc:") ? openId.slice(4) : null;
  const owner = unwrap(await supabase.from("owner").select("id, role").eq(ownerId ? "id" : "user_open_id", ownerId ?? openId).eq("is_active", true).maybeSingle());
  if (!owner || !["commissioner", "administrator"].includes(owner.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Commissioner access is required." });
  return owner;
}
export const auctionRouter = router({
  board: publicProcedure.query(async () => {
    const { season, draft } = await context();
    const states = unwrap(await supabase.from("auction_team_state").select("franchise_id, starting_budget, franchise(name, abbreviation, brand_color, logo_url)").eq("draft_id", draft.id)) ?? [];
    // spent_budget/roster_count are NOT trusted from auction_team_state's own stored
    // counters — those only increment when award()/recordPick() runs, so any roster
    // established outside that flow (CSV import, direct SQL corrections, trades) never
    // gets reflected there and the board silently drifts from reality. Computed live
    // from the actual current contracts/roster instead, which can't drift.
    const franchiseIds = states.map(state => state.franchise_id);
    const [contractsResult, assignmentsResult] = franchiseIds.length ? await Promise.all([
      supabase.from("player_contract").select("franchise_id, salary").eq("season_id", season.id).eq("contract_status", "active").in("franchise_id", franchiseIds),
      supabase.from("roster_assignment").select("franchise_id").eq("season_id", season.id).is("released_at", null).in("franchise_id", franchiseIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const spentByFranchise = new Map<string, number>();
    for (const row of unwrap(contractsResult) ?? []) spentByFranchise.set(row.franchise_id, (spentByFranchise.get(row.franchise_id) ?? 0) + Number(row.salary));
    const rosterCountByFranchise = new Map<string, number>();
    for (const row of unwrap(assignmentsResult) ?? []) rosterCountByFranchise.set(row.franchise_id, (rosterCountByFranchise.get(row.franchise_id) ?? 0) + 1);
    const liveStates = states.map(state => ({ ...state, spent_budget: spentByFranchise.get(state.franchise_id) ?? 0, roster_count: rosterCountByFranchise.get(state.franchise_id) ?? 0 }));
    const active = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_franchise_id, high_bid, status, player(display_name, position, nfl_team), nominator:franchise!auction_nomination_nominating_franchise_id_fkey(name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    const recent = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_bid, player(display_name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "awarded").order("awarded_at", { ascending: false }).limit(8));
    return { draft, states: liveStates, active, recent };
  }),
  eligiblePlayers: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(1000).optional() }).optional()).query(async ({ input }) => {
    const { season, draft } = await context();
    const limit = input?.limit ?? 75;
    if (input?.position && !isCvcAuctionPosition(input.position)) return [];
    const cacheStatus = await fantasyProsCacheStatus();
    let playerQuery = supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").in("position", input?.position ? [input.position] : CVC_AUCTION_POSITIONS).order("display_name").limit(limit + 220);
    // Excludes players who dropped off FantasyPros' most recent player list -- very
    // likely retired or out of the league (confirmed nfl_team is nearly always
    // populated regardless, since FantasyPros doesn't clear it on retirement -- see the
    // last_seen_at migration notes). Only applied once at least one sync has actually
    // run: before that, last_seen_at is null for every player, and requiring it would
    // hide the ENTIRE pool rather than narrow it, so the filter is skipped rather than
    // failing closed.
    if (cacheStatus.fetchedAt) playerQuery = playerQuery.gte("last_seen_at", cacheStatus.fetchedAt);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position);
    const [playersResult, activeAssignmentsResult, awardedResult, rookieDraftResult] = await Promise.all([
      playerQuery,
      supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).is("released_at", null),
      supabase.from("auction_nomination").select("player_id").eq("draft_id", draft.id).eq("status", "awarded"),
      supabase.from("draft").select("status").eq("season_id", season.id).eq("draft_type", "rookie").maybeSingle(),
    ]);
    const activePlayerIds = new Set((unwrap(activeAssignmentsResult) ?? []).map(assignment => assignment.player_id));
    const activeRosteredPlayers = activePlayerIds.size ? unwrap(await supabase.from("player").select("display_name").in("id", Array.from(activePlayerIds))) ?? [] : [];
    const activePlayerNames = new Set(activeRosteredPlayers.map(player => playerIdentity(player.display_name)));
    const awardedPlayerIds = new Set((unwrap(awardedResult) ?? []).map(award => award.player_id));
    // The rookie draft runs first. Until it's marked complete, rookies are blocked from
    // the regular auction entirely. Once complete, a rookie who WAS selected is already
    // rostered (recordDraftSelection creates their roster_assignment), so the
    // activePlayerIds check above already excludes them — only undrafted rookies remain
    // unrostered and become auction-eligible here.
    const rookieDraftComplete = unwrap(rookieDraftResult)?.status === "complete";
    const filtered = (unwrap(playersResult) ?? []).filter(player => {
      const metadata = (player.metadata ?? {}) as { is_rookie?: boolean };
      if (!rookieDraftComplete && metadata.is_rookie) return false;
      return !activePlayerIds.has(player.id) && !activePlayerNames.has(playerIdentity(player.display_name)) && !awardedPlayerIds.has(player.id);
    });
    // Some player names have duplicate rows in the underlying table (separate provider
    // syncs). Since none of these were eligible-elimination candidates above (all are
    // unrostered), a duplicate name would otherwise appear twice in this list — dedupe
    // to one row per name, keeping the first (display_name-sorted) occurrence.
    const seenNames = new Set<string>();
    const deduped = filtered.filter(player => {
      const key = playerIdentity(player.display_name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
    return deduped.slice(0, limit);
  }),
  setBudget: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), startingBudget: z.number().int().min(0).max(115) })).mutation(async ({ ctx: c, input }) => {
    await commissioner(c.user.openId); const { draft } = await context();
    return unwrap(await supabase.from("auction_team_state").upsert({ draft_id: draft.id, franchise_id: input.franchiseId, starting_budget: input.startingBudget }, { onConflict: "draft_id,franchise_id" }).select().single());
  }),
  nominate: protectedProcedure.input(z.object({ playerId: z.string().uuid() })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const auctionContext = await context(); const { draft, season } = auctionContext;
    const existing = unwrap(await supabase.from("auction_nomination").select("id").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "Award or pass the active player first." });
    const ownedFranchise = unwrap(await supabase.from("franchise").select("id").eq("current_owner_id", actor.id).eq("is_active", true).maybeSingle());
    const nominatorState = unwrap(await supabase.from("auction_team_state").select("franchise_id").eq("draft_id", draft.id).eq("franchise_id", ownedFranchise?.id ?? "").maybeSingle())
      ?? unwrap(await supabase.from("auction_team_state").select("franchise_id").eq("draft_id", draft.id).order("franchise_id").limit(1).maybeSingle());
    if (!nominatorState) throw new TRPCError({ code: "BAD_REQUEST", message: "Configure at least one franchise budget before starting the CVC auction." });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
    const rostered = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1));
    if ((rostered ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players are not auction eligible." });
    const player = unwrap(await supabase.from("player").select("provider, position, metadata").eq("id", input.playerId).maybeSingle());
    if (!player || player.provider === "placeholder") throw new TRPCError({ code: "BAD_REQUEST", message: "Only imported CVC player records are auction eligible." });
    if (!isCvcAuctionPosition(player.position)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only QB, RB, WR, TE, K, and D/ST players are eligible for the CVC auction." });
    await assertRookieAuctionEligible(season.id, Boolean(((player.metadata ?? {}) as { is_rookie?: boolean }).is_rookie));
    return unwrap(await supabase.from("auction_nomination").insert({ draft_id: draft.id, player_id: input.playerId, nominating_franchise_id: nominatorState.franchise_id }).select().single());
  }),
  award: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), amount: z.number().int().min(1) })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const nomination = unwrap(await supabase.from("auction_nomination").select("id, player_id").eq("draft_id", draft.id).eq("status", "active").single());
    const state = await liveTeamState(season.id, draft.id, input.franchiseId);
    if (!season || !nomination || !state) throw new TRPCError({ code: "NOT_FOUND", message: "Required CVC auction record was not found." });
    const legalMax = calculateAuctionLegalMaxBid(state.starting_budget, state.spent_budget, state.roster_count);
    if (state.roster_count >= 22) throw new TRPCError({ code: "BAD_REQUEST", message: "This franchise has reached 22 players." });
    if (input.amount > legalMax) throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum legal bid is $${legalMax}.` });
    unwrap(await supabase.from("auction_nomination").update({ high_franchise_id: input.franchiseId, high_bid: input.amount, status: "awarded", awarded_at: new Date().toISOString() }).eq("id", nomination.id));
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: input.franchiseId, player_id: nomination.player_id, roster_state: "active" }));
    // Contract term follows CVC's standard salary rule: $10+ salary earns a 3-year
    // contract, $9-or-less earns 2 years (shared/cvcProtectionPolicy.cvcContractTier —
    // the same rule already used for franchise-tag terms elsewhere in the app).
    const contractYears = cvcFranchiseTerms(cvcContractTier(input.amount));
    unwrap(await supabase.from("player_contract").upsert({ season_id: season.id, franchise_id: input.franchiseId, player_id: nomination.player_id, salary: input.amount, expires_year: season.year + contractYears - 1, source_marker: null, contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: input.franchiseId, actor_owner_id: actor.id, transaction_type: "draft_pick", status: "final", summary: `Auction award for $${input.amount}`, details: { nominationId: nomination.id, amount: input.amount } }));
    return { success: true, legalMax };
  }),
  correctAward: protectedProcedure.input(z.object({ nominationId: z.string().uuid(), reason: z.string().trim().max(280).optional() })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const nomination = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_franchise_id, high_bid, status").eq("id", input.nominationId).eq("draft_id", draft.id).maybeSingle());
    if (!nomination || nomination.status !== "awarded" || !nomination.high_franchise_id || !nomination.high_bid) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a completed CVC auction award can be corrected." });
    const budgetRow = unwrap(await supabase.from("auction_team_state").select("franchise_id").eq("draft_id", draft.id).eq("franchise_id", nomination.high_franchise_id).maybeSingle());
    const roster = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", nomination.high_franchise_id).eq("player_id", nomination.player_id).is("released_at", null).order("acquired_at", { ascending: false }).limit(1).maybeSingle());
    if (!budgetRow || !roster) throw new TRPCError({ code: "CONFLICT", message: "The award cannot be corrected because its active roster or budget record is unavailable." });
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", roster.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("season_id", season.id).eq("franchise_id", nomination.high_franchise_id).eq("player_id", nomination.player_id).select("id"));
    unwrap(await supabase.from("auction_nomination").update({ status: "corrected", correction_reason: input.reason ?? "Commissioner correction", updated_at: new Date().toISOString() }).eq("id", nomination.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: nomination.high_franchise_id, actor_owner_id: actor.id, transaction_type: "commissioner_adjustment", status: "final", summary: `Auction award corrected: $${nomination.high_bid} restored`, details: { nominationId: nomination.id, playerId: nomination.player_id, reason: input.reason } }).select("id").single());
    return { success: true } as const;
  }),

  // Records a full pick (player + winning franchise + salary) in one step. Nomination
  // and bidding happen live in the room, not in the app, so this is the sole way a
  // commissioner-console pick gets recorded — both the manual "Record a pick" form and
  // the voice-pick recorder call this after the commissioner reviews/confirms the
  // player, franchise, and amount. Functionally equivalent to nominate() + award() run
  // back to back (same validation, same nomination/roster/contract/transaction
  // records), just without requiring a prior "active nomination" in the app.
  recordPick: protectedProcedure.input(z.object({ playerId: z.string().uuid(), franchiseId: z.string().uuid(), amount: z.number().int().min(1) })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const existing = unwrap(await supabase.from("auction_nomination").select("id").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "Award or pass the active player first." });
    const rostered = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1));
    if ((rostered ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players are not auction eligible." });
    const player = unwrap(await supabase.from("player").select("provider, position, metadata").eq("id", input.playerId).maybeSingle());
    if (!player || player.provider === "placeholder") throw new TRPCError({ code: "BAD_REQUEST", message: "Only imported CVC player records are auction eligible." });
    if (!isCvcAuctionPosition(player.position)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only QB, RB, WR, TE, K, and D/ST players are eligible for the CVC auction." });
    await assertRookieAuctionEligible(season.id, Boolean(((player.metadata ?? {}) as { is_rookie?: boolean }).is_rookie));
    const alreadyAwarded = unwrap(await supabase.from("auction_nomination").select("id").eq("draft_id", draft.id).eq("player_id", input.playerId).eq("status", "awarded").maybeSingle());
    if (alreadyAwarded) throw new TRPCError({ code: "CONFLICT", message: "This player has already been awarded in the CVC auction." });
    const state = await liveTeamState(season.id, draft.id, input.franchiseId);
    if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "This franchise has no CVC auction budget configured." });
    const legalMax = calculateAuctionLegalMaxBid(state.starting_budget, state.spent_budget, state.roster_count);
    if (state.roster_count >= 22) throw new TRPCError({ code: "BAD_REQUEST", message: "This franchise has reached 22 players." });
    if (input.amount > legalMax) throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum legal bid is $${legalMax}.` });
    const nomination = unwrap(await supabase.from("auction_nomination").insert({ draft_id: draft.id, player_id: input.playerId, nominating_franchise_id: input.franchiseId, high_franchise_id: input.franchiseId, high_bid: input.amount, status: "awarded", awarded_at: new Date().toISOString() }).select("id").single());
    if (!nomination) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC voice pick could not be saved." });
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: input.franchiseId, player_id: input.playerId, roster_state: "active" }));
    const contractYears = cvcFranchiseTerms(cvcContractTier(input.amount));
    unwrap(await supabase.from("player_contract").upsert({ season_id: season.id, franchise_id: input.franchiseId, player_id: input.playerId, salary: input.amount, expires_year: season.year + contractYears - 1, source_marker: null, contract_status: "active" }, { onConflict: "season_id,franchise_id,player_id" }).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: input.franchiseId, actor_owner_id: actor.id, transaction_type: "draft_pick", status: "final", summary: `Auction pick recorded for $${input.amount}`, details: { nominationId: nomination.id, amount: input.amount, source: "commissioner_console" } }));
    return { success: true, legalMax };
  }),
});
