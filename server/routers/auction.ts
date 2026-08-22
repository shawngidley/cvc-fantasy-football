import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { supabase, unwrap } from "../supabase";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

async function context() {
  const season = unwrap(await supabase.from("season").select("id, league_id").order("year", { ascending: false }).limit(1).single());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
  const draft = unwrap(await supabase.from("draft").select("id, status, label").eq("season_id", season.id).eq("draft_type", "auction").limit(1).maybeSingle());
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC auction draft has not been configured." });
  return { season, draft };
}
async function commissioner(openId: string) {
  const owner = unwrap(await supabase.from("owner").select("id, role").eq("user_open_id", openId).maybeSingle());
  if (!owner || !["commissioner", "administrator"].includes(owner.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Commissioner access is required." });
  return owner;
}
export const auctionRouter = router({
  board: publicProcedure.query(async () => {
    const { draft } = await context();
    const states = unwrap(await supabase.from("auction_team_state").select("franchise_id, starting_budget, spent_budget, roster_count, franchise(name, abbreviation, brand_color)").eq("draft_id", draft.id));
    const active = unwrap(await supabase.from("auction_nomination").select("id, player_id, high_franchise_id, high_bid, status, player(display_name, position, nfl_team), nominator:franchise!auction_nomination_nominating_franchise_id_fkey(name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    const recent = unwrap(await supabase.from("auction_nomination").select("id, high_bid, player(display_name), leader:franchise!auction_nomination_high_franchise_id_fkey(name)").eq("draft_id", draft.id).eq("status", "awarded").order("awarded_at", { ascending: false }).limit(8));
    return { draft, states, active, recent };
  }),
  setBudget: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), startingBudget: z.number().int().min(0).max(115) })).mutation(async ({ ctx: c, input }) => {
    await commissioner(c.user.openId); const { draft } = await context();
    return unwrap(await supabase.from("auction_team_state").upsert({ draft_id: draft.id, franchise_id: input.franchiseId, starting_budget: input.startingBudget }, { onConflict: "draft_id,franchise_id" }).select().single());
  }),
  nominate: protectedProcedure.input(z.object({ playerId: z.string().uuid(), nominatingFranchiseId: z.string().uuid() })).mutation(async ({ ctx: c, input }) => {
    await commissioner(c.user.openId); const auctionContext = await context(); const { draft, season } = auctionContext;
    const existing = unwrap(await supabase.from("auction_nomination").select("id").eq("draft_id", draft.id).eq("status", "active").maybeSingle());
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "Award or pass the active player first." });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
    const rostered = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1));
    if ((rostered ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players are not auction eligible." });
    return unwrap(await supabase.from("auction_nomination").insert({ draft_id: draft.id, player_id: input.playerId, nominating_franchise_id: input.nominatingFranchiseId }).select().single());
  }),
  award: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), amount: z.number().int().min(1) })).mutation(async ({ ctx: c, input }) => {
    const actor = await commissioner(c.user.openId); const { season, draft } = await context();
    const nomination = unwrap(await supabase.from("auction_nomination").select("id, player_id").eq("draft_id", draft.id).eq("status", "active").single());
    const state = unwrap(await supabase.from("auction_team_state").select("starting_budget, spent_budget, roster_count").eq("draft_id", draft.id).eq("franchise_id", input.franchiseId).single());
    if (!season || !nomination || !state) throw new TRPCError({ code: "NOT_FOUND", message: "Required CVC auction record was not found." });
    const legalMax = state.starting_budget - state.spent_budget - Math.max(0, 14 - state.roster_count);
    if (state.roster_count >= 22) throw new TRPCError({ code: "BAD_REQUEST", message: "This franchise has reached 22 players." });
    if (input.amount > legalMax) throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum legal bid is $${legalMax}.` });
    unwrap(await supabase.from("auction_nomination").update({ high_franchise_id: input.franchiseId, high_bid: input.amount, status: "awarded", awarded_at: new Date().toISOString() }).eq("id", nomination.id));
    unwrap(await supabase.from("auction_team_state").update({ spent_budget: state.spent_budget + input.amount, roster_count: state.roster_count + 1, updated_at: new Date().toISOString() }).eq("draft_id", draft.id).eq("franchise_id", input.franchiseId));
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: input.franchiseId, player_id: nomination.player_id, roster_state: "active" }));
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: input.franchiseId, actor_owner_id: actor.id, transaction_type: "draft_pick", status: "final", summary: `Auction award for $${input.amount}`, details: { nominationId: nomination.id, amount: input.amount } }));
    return { success: true, legalMax };
  }),
});
