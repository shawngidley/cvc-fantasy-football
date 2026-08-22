import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { supabase, unwrap } from "../supabase";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

export function calculateAuctionLegalMaxBid(startingBudget: number, spentBudget: number, rosterCount: number) {
  return startingBudget - spentBudget - Math.max(0, 14 - rosterCount);
}

const playerIdentity = (name: string | null | undefined) => (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const CVC_AUCTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST", "D/ST"] as const;
const isCvcAuctionPosition = (position: string | null | undefined) => CVC_AUCTION_POSITIONS.includes((position ?? "").toUpperCase() as typeof CVC_AUCTION_POSITIONS[number]);

async function context() {
  const season = unwrap(await supabase.from("season").select("id, league_id").order("year", { ascending: false }).limit(1).single());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
  const draft = unwrap(await supabase.from("draft").select("id, status, label").eq("season_id", season.id).eq("draft_type", "auction").limit(1).maybeSingle());
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC auction draft has not been configured." });
  return { season, draft };
}
async function commissioner(openId: string) {
  const ownerId = openId.startsWith("cvc:") ? openId.slice(4) : null;
  const owner = unwrap(await supabase.from("owner").select("id, role").eq(ownerId ? "id" : "user_open_id", ownerId ?? openId).eq("is_active", true).maybeSingle());
  if (!owner || !["commissioner", "administrator"].includes(owner.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Commissioner access is required." });
  return owner;
}
export const auctionRouter = router({
  board: publicProcedure.query(async () => {
    const { draft } = await context();
    const states = unwrap(await supabase.from("auction_team_state").select("franchise_id, starting_budget, spent_budget, roster_count, franchise(name, abbreviation, brand_color, logo_url)").eq("draft_id", draft.id));
    const active = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_franchise_id, high_bid, status, player(display_name, position, nfl_team), nominator:franchise!auction_nomination_nominating_franchise_id_fkey(name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    const recent = unwrap(await supabase.from("auction_nomination").select("id, high_bid, player(display_name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "awarded").order("awarded_at", { ascending: false }).limit(8));
    return { draft, states, active, recent };
  }),
  eligiblePlayers: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(150).optional() }).optional()).query(async ({ input }) => {
    const { season, draft } = await context();
    const limit = input?.limit ?? 75;
    if (input?.position && !isCvcAuctionPosition(input.position)) return [];
    let playerQuery = supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").in("position", input?.position ? [input.position] : CVC_AUCTION_POSITIONS).order("display_name").limit(limit + 220);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position);
    const [playersResult, activeAssignmentsResult, awardedResult] = await Promise.all([
      playerQuery,
      supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).is("released_at", null),
      supabase.from("auction_nomination").select("player_id").eq("draft_id", draft.id).eq("status", "awarded"),
    ]);
    const activePlayerIds = new Set((unwrap(activeAssignmentsResult) ?? []).map(assignment => assignment.player_id));
    const activeRosteredPlayers = activePlayerIds.size ? unwrap(await supabase.from("player").select("display_name").in("id", Array.from(activePlayerIds))) ?? [] : [];
    const activePlayerNames = new Set(activeRosteredPlayers.map(player => playerIdentity(player.display_name)));
    const awardedPlayerIds = new Set((unwrap(awardedResult) ?? []).map(award => award.player_id));
    return (unwrap(playersResult) ?? []).filter(player => {
      const metadata = (player.metadata ?? {}) as { is_rookie?: boolean };
      return !activePlayerIds.has(player.id) && !activePlayerNames.has(playerIdentity(player.display_name)) && !awardedPlayerIds.has(player.id) && !metadata.is_rookie;
    }).slice(0, limit);
  }),
  setBudget: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), startingBudget: z.number().int().min(0).max(115) })).mutation(async ({ ctx: c, input }) => {
    await commissioner(c.user.openId); const { draft } = await context();
    return unwrap(await supabase.from("auction_team_state").upsert({ draft_id: draft.id, franchise_id: input.franchiseId, starting_budget: input.startingBudget }, { onConflict: "draft_id,franchise_id" }).select().single());
  }),
  nominate: protectedProcedure.input(z.object({ playerId: z.string().uuid(), nominatingFranchiseId: z.string().uuid() })).mutation(async ({ ctx: c, input }) => {
    await commissioner(c.user.openId); const auctionContext = await context(); const { draft, season } = auctionContext;
    const existing = unwrap(await supabase.from("auction_nomination").select("id").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "Award or pass the active player first." });
    const nominatorState = unwrap(await supabase.from("auction_team_state").select("franchise_id").eq("draft_id", draft.id).eq("franchise_id", input.nominatingFranchiseId).maybeSingle());
    if (!nominatorState) throw new TRPCError({ code: "BAD_REQUEST", message: "Set this franchise’s starting budget before using it as a nominator." });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
    const rostered = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1));
    if ((rostered ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players are not auction eligible." });
    const player = unwrap(await supabase.from("player").select("provider, position, metadata").eq("id", input.playerId).maybeSingle());
    if (!player || player.provider === "placeholder") throw new TRPCError({ code: "BAD_REQUEST", message: "Only imported CVC player records are auction eligible." });
    if (!isCvcAuctionPosition(player.position)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only QB, RB, WR, TE, K, and D/ST players are eligible for the CVC auction." });
    if (((player.metadata ?? {}) as { is_rookie?: boolean }).is_rookie) throw new TRPCError({ code: "BAD_REQUEST", message: "Rookies are not eligible for the regular CVC auction." });
    return unwrap(await supabase.from("auction_nomination").insert({ draft_id: draft.id, player_id: input.playerId, nominating_franchise_id: input.nominatingFranchiseId }).select().single());
  }),
  award: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), amount: z.number().int().min(1) })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const nomination = unwrap(await supabase.from("auction_nomination").select("id, player_id").eq("draft_id", draft.id).eq("status", "active").single());
    const state = unwrap(await supabase.from("auction_team_state").select("starting_budget, spent_budget, roster_count").eq("draft_id", draft.id).eq("franchise_id", input.franchiseId).single());
    if (!season || !nomination || !state) throw new TRPCError({ code: "NOT_FOUND", message: "Required CVC auction record was not found." });
    const legalMax = calculateAuctionLegalMaxBid(state.starting_budget, state.spent_budget, state.roster_count);
    if (state.roster_count >= 22) throw new TRPCError({ code: "BAD_REQUEST", message: "This franchise has reached 22 players." });
    if (input.amount > legalMax) throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum legal bid is $${legalMax}.` });
    unwrap(await supabase.from("auction_nomination").update({ high_franchise_id: input.franchiseId, high_bid: input.amount, status: "awarded", awarded_at: new Date().toISOString() }).eq("id", nomination.id));
    unwrap(await supabase.from("auction_team_state").update({ spent_budget: state.spent_budget + input.amount, roster_count: state.roster_count + 1, updated_at: new Date().toISOString() }).eq("draft_id", draft.id).eq("franchise_id", input.franchiseId));
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: input.franchiseId, player_id: nomination.player_id, roster_state: "active" }));
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: input.franchiseId, actor_owner_id: actor.id, transaction_type: "draft_pick", status: "final", summary: `Auction award for $${input.amount}`, details: { nominationId: nomination.id, amount: input.amount } }));
    return { success: true, legalMax };
  }),
  correctAward: protectedProcedure.input(z.object({ nominationId: z.string().uuid(), reason: z.string().trim().min(3).max(280) })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const nomination = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_franchise_id, high_bid, status").eq("id", input.nominationId).eq("draft_id", draft.id).maybeSingle());
    if (!nomination || nomination.status !== "awarded" || !nomination.high_franchise_id || !nomination.high_bid) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a completed CVC auction award can be corrected." });
    const state = unwrap(await supabase.from("auction_team_state").select("spent_budget, roster_count").eq("draft_id", draft.id).eq("franchise_id", nomination.high_franchise_id).maybeSingle());
    const roster = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", nomination.high_franchise_id).eq("player_id", nomination.player_id).is("released_at", null).order("acquired_at", { ascending: false }).limit(1).maybeSingle());
    if (!state || !roster) throw new TRPCError({ code: "CONFLICT", message: "The award cannot be corrected because its active roster or budget record is unavailable." });
    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", roster.id).select("id").single());
    unwrap(await supabase.from("auction_team_state").update({ spent_budget: Math.max(0, state.spent_budget - nomination.high_bid), roster_count: Math.max(0, state.roster_count - 1), updated_at: new Date().toISOString() }).eq("draft_id", draft.id).eq("franchise_id", nomination.high_franchise_id).select("id").single());
    unwrap(await supabase.from("auction_nomination").update({ status: "corrected", correction_reason: input.reason, updated_at: new Date().toISOString() }).eq("id", nomination.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: nomination.high_franchise_id, actor_owner_id: actor.id, transaction_type: "commissioner_adjustment", status: "final", summary: `Auction award corrected: $${nomination.high_bid} restored`, details: { nominationId: nomination.id, playerId: nomination.player_id, reason: input.reason } }).select("id").single());
    return { success: true } as const;
  }),
});
