import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getNFLDataAdapter } from "../nflDataAdapter";
import { supabase, unwrap } from "../supabase";

type CurrentUser = { openId: string };

async function getOwnerAccess(user: CurrentUser) {
  const owner = unwrap(await supabase
    .from("owner")
    .select("id, league_id, display_name, role")
    .eq("user_open_id", user.openId)
    .limit(1)
    .maybeSingle());
  if (!owner && ENV.ownerOpenId && user.openId === ENV.ownerOpenId) {
    const commissioner = unwrap(await supabase
      .from("owner")
      .select("id, league_id, display_name, role")
      .eq("display_name", "Commissioner Placeholder")
      .limit(1)
      .maybeSingle());
    if (commissioner) {
      unwrap(await supabase.from("owner").update({ user_open_id: user.openId }).eq("id", commissioner.id).select("id").single());
      return commissioner;
    }
  }
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
  const season = unwrap(await supabase.from("season").select("id").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season configuration was not found." });
  return { league, season };
}

async function createAuditEvent(leagueId: string, seasonId: string, actorOwnerId: string, entityType: string, entityId: string | null, action: string, summary: string) {
  unwrap(await supabase.from("audit_event").insert({ league_id: leagueId, season_id: seasonId, actor_owner_id: actorOwnerId, entity_type: entityType, entity_id: entityId, action, summary }).select("id").single());
}

export const leagueRouter = router({
  overview: publicProcedure.query(async () => {
    const [league, season, franchises, owners, weeks, matchups] = await Promise.all([
      supabase.from("league").select("id, slug, name, short_name, timezone, primary_color, accent_color").eq("slug", "cvc-auction-football").single(),
      supabase.from("season").select("id, year, label, status, regular_season_weeks, playoff_teams").order("year", { ascending: false }).limit(1).single(),
      supabase.from("franchise").select("id, name, abbreviation, division_name, current_owner_id, brand_color, display_order").eq("is_active", true).order("display_order"),
      supabase.from("owner").select("id, display_name, role").eq("is_active", true),
      supabase.from("schedule_week").select("id, week_number, label, status").order("week_number"),
      supabase.from("matchup").select("id, schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, home_projection, away_projection, result_state").order("created_at"),
    ]);

    const leagueData = unwrap(league);
    const seasonData = unwrap(season);
    const franchiseRows = unwrap(franchises) ?? [];
    const ownerRows = unwrap(owners) ?? [];
    const weekRows = unwrap(weeks) ?? [];
    const matchupRows = unwrap(matchups) ?? [];
    const ownerById = new Map(ownerRows.map(owner => [owner.id, owner]));
    const teamById = new Map(franchiseRows.map(franchise => [franchise.id, franchise]));
    const weekById = new Map(weekRows.map(week => [week.id, week]));

    const franchisesWithRecord = franchiseRows.map(franchise => {
      const completed = matchupRows.filter(matchup => matchup.result_state === "final" && (matchup.home_franchise_id === franchise.id || matchup.away_franchise_id === franchise.id));
      const record = completed.reduce((summary, matchup) => {
        const isHome = matchup.home_franchise_id === franchise.id;
        const ownScore = Number(isHome ? matchup.home_score : matchup.away_score);
        const opposingScore = Number(isHome ? matchup.away_score : matchup.home_score);
        return {
          wins: summary.wins + Number(ownScore > opposingScore),
          losses: summary.losses + Number(ownScore < opposingScore),
          pointsFor: summary.pointsFor + ownScore,
        };
      }, { wins: 0, losses: 0, pointsFor: 0 });
      return {
        ...franchise,
        owner: franchise.current_owner_id ? ownerById.get(franchise.current_owner_id)?.display_name ?? "Unassigned" : "Unassigned",
        record: `${record.wins}–${record.losses}`,
        pointsFor: record.pointsFor,
      };
    }).sort((left, right) => right.pointsFor - left.pointsFor);

    return {
      league: leagueData,
      season: seasonData,
      franchises: franchisesWithRecord,
      matchups: matchupRows.map(matchup => ({
        ...matchup,
        week: weekById.get(matchup.schedule_week_id),
        home: teamById.get(matchup.home_franchise_id)?.name ?? "TBD",
        away: teamById.get(matchup.away_franchise_id)?.name ?? "TBD",
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
    const { data: season, error: seasonError } = await supabase.from("season").select("id").order("year", { ascending: false }).limit(1).single();
    if (seasonError || !season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season configuration was not found." });
    const { data, error } = await supabase.from("transaction").select("id, transaction_type, status, summary, occurred_at, details").eq("season_id", season.id).order("occurred_at", { ascending: false }).limit(50);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  draftBoard: publicProcedure.query(async () => {
    const { data: draft, error: draftError } = await supabase.from("draft").select("id, label, draft_type, status, pick_timer_seconds, keeper_enabled, lottery_enabled, settings").limit(1).single();
    if (draftError || !draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC draft configuration was not found." });
    const [picksResult, franchisesResult] = await Promise.all([
      supabase.from("draft_pick").select("id, round_number, pick_number, original_franchise_id, current_franchise_id, pick_status, is_protected, notes").eq("draft_id", draft.id).order("pick_number").limit(500),
      supabase.from("franchise").select("id, name, abbreviation").eq("is_active", true).limit(100),
    ]);
    const picks = unwrap(picksResult) ?? [];
    const franchises = unwrap(franchisesResult) ?? [];
    const franchiseById = new Map(franchises.map(franchise => [franchise.id, franchise]));
    return { ...draft, picks: picks.map(pick => ({ ...pick, originalFranchise: franchiseById.get(pick.original_franchise_id)?.name ?? "Unknown", currentFranchise: franchiseById.get(pick.current_franchise_id)?.name ?? "Unknown" })) };
  }),

  franchiseRoster: publicProcedure.input(z.object({ franchiseId: z.string().uuid() })).query(async ({ input }) => {
    const { data: franchise, error: franchiseError } = await supabase.from("franchise").select("id, name, abbreviation, division_name, brand_color, current_owner_id").eq("id", input.franchiseId).single();
    if (franchiseError || !franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    const { data: season, error: seasonError } = await supabase.from("season").select("id").order("year", { ascending: false }).limit(1).single();
    if (seasonError || !season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
    const assignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, roster_state, assigned_slot_code, acquired_at").eq("season_id", season.id).eq("franchise_id", franchise.id).is("released_at", null).order("acquired_at")) ?? [];
    const playerIds = assignments.map(item => item.player_id);
    const players = playerIds.length ? unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, status").in("id", playerIds)) ?? [] : [];
    const playerById = new Map(players.map(player => [player.id, player]));
    return { franchise, players: assignments.map(assignment => ({ ...assignment, player: playerById.get(assignment.player_id) ?? null })) };
  }),

  playerDirectory: publicProcedure.query(async () => {
    const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").order("display_name").limit(250)) ?? [];
    return players;
  }),

  playerDetail: publicProcedure.input(z.object({ playerId: z.string().uuid() })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("id, provider, external_id, display_name, position, nfl_team, status, metadata, created_at, updated_at").eq("id", input.playerId).maybeSingle());
    if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    return player;
  }),

  nflProviderStatus: publicProcedure.query(async () => getNFLDataAdapter().status()),

  myFranchise: protectedProcedure.query(async ({ ctx }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Your account is not associated with a CVC owner record." });
    const franchise = unwrap(await supabase.from("franchise").select("id, name, abbreviation, division_name").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
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

  saveMatchup: protectedProcedure.input(z.object({ weekNumber: z.number().int().min(1).max(30), homeFranchiseId: z.string().uuid(), awayFranchiseId: z.string().uuid(), resultState: z.enum(["upcoming", "live", "final", "corrected"]) }).refine(value => value.homeFranchiseId !== value.awayFranchiseId, { message: "A franchise cannot play itself." })).mutation(async ({ ctx, input }) => {
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
