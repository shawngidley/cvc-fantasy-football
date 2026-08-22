import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { clearCvcOwnerSession, getCvcOwnerSession, hashPin, issueCvcOwnerSession, requireCvcOwnerSession, verifyPin } from "../cvcOwnerAuth";
import { router, publicProcedure } from "../_core/trpc";
import { supabase, unwrap } from "../supabase";

async function ownerSummary(ownerId: string) {
  const owner = unwrap(await supabase.from("owner").select("id, display_name, role").eq("id", ownerId).eq("is_active", true).maybeSingle());
  if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "CVC owner record was not found." });
  const franchise = unwrap(await supabase.from("franchise").select("id, name, abbreviation").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
  return { id: owner.id, displayName: owner.display_name, role: owner.role, franchise };
}

export const ownerAuthRouter = router({
  owners: publicProcedure.query(async () => {
    const owners = unwrap(await supabase.from("owner").select("id, display_name, role").eq("is_active", true).order("display_name")) ?? [];
    const franchises = unwrap(await supabase.from("franchise").select("id, name, abbreviation, current_owner_id").eq("is_active", true)) ?? [];
    const franchiseByOwnerId = new Map(franchises.filter(franchise => franchise.current_owner_id).map(franchise => [franchise.current_owner_id!, franchise]));
    return owners.map(owner => ({ id: owner.id, displayName: owner.display_name, role: owner.role, franchise: franchiseByOwnerId.get(owner.id) ?? null }));
  }),

  session: publicProcedure.query(async ({ ctx }) => {
    const session = await getCvcOwnerSession(ctx.req);
    return session ? ownerSummary(session.owner.id) : null;
  }),

  signIn: publicProcedure.input(z.object({ ownerId: z.string().uuid(), pin: z.string() })).mutation(async ({ ctx, input }) => {
    const owner = unwrap(await supabase.from("owner").select("id, pin_hash").eq("id", input.ownerId).eq("is_active", true).maybeSingle());
    if (!owner || !verifyPin(input.pin, owner.pin_hash)) throw new TRPCError({ code: "UNAUTHORIZED", message: "The selected owner and PIN do not match." });
    await issueCvcOwnerSession(ctx.req, ctx.res, owner.id);
    return ownerSummary(owner.id);
  }),

  signOut: publicProcedure.mutation(async ({ ctx }) => {
    await clearCvcOwnerSession(ctx.req, ctx.res);
    return { success: true } as const;
  }),

  changePin: publicProcedure.input(z.object({ currentPin: z.string(), newPin: z.string() })).mutation(async ({ ctx, input }) => {
    const session = await requireCvcOwnerSession(ctx.req);
    const owner = unwrap(await supabase.from("owner").select("id, pin_hash").eq("id", session.owner.id).eq("is_active", true).maybeSingle());
    if (!owner || !verifyPin(input.currentPin, owner.pin_hash)) throw new TRPCError({ code: "FORBIDDEN", message: "Your current CVC PIN is incorrect." });
    const newHash = hashPin(input.newPin);
    unwrap(await supabase.from("owner").update({ pin_hash: newHash, pin_updated_at: new Date().toISOString() }).eq("id", owner.id).select("id").single());
    unwrap(await supabase.from("owner_session").delete().eq("owner_id", owner.id).select("id"));
    await issueCvcOwnerSession(ctx.req, ctx.res, owner.id);
    return { success: true } as const;
  }),

  resetPin: publicProcedure.input(z.object({ ownerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const session = await requireCvcOwnerSession(ctx.req);
    if (!["commissioner", "administrator"].includes(session.owner.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only CVC commissioners and administrators can reset owner PINs." });
    const owner = unwrap(await supabase.from("owner").select("id, display_name, league_id").eq("id", input.ownerId).eq("is_active", true).maybeSingle());
    if (!owner || owner.league_id !== session.owner.league_id) throw new TRPCError({ code: "NOT_FOUND", message: "The selected active CVC owner was not found." });
    unwrap(await supabase.from("owner").update({ pin_hash: hashPin("1234"), pin_updated_at: new Date().toISOString() }).eq("id", owner.id).select("id").single());
    unwrap(await supabase.from("owner_session").delete().eq("owner_id", owner.id).select("id"));
    return { success: true, displayName: owner.display_name } as const;
  }),
});
