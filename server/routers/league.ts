import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getFantasyProsDataAdapter, getNFLDataAdapter } from "../nflDataAdapter";
import { fantasyProsCacheStatus } from "../fantasyProsCache";
import { syncFantasyProsSnapshot } from "../fantasyProsSync";
import { supabase, unwrap } from "../supabase";

type CurrentUser = { openId: string };

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
  const season = unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle());
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
    const contracts = playerIds.length ? unwrap(await supabase.from("player_contract").select("player_id, salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).in("player_id", playerIds)) ?? [] : [];
    const rights = playerIds.length ? unwrap(await supabase.from("player_right").select("id, player_id, right_type, status, salary_basis, contract_years, expires_year, metadata").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("status", "active").in("player_id", playerIds)) ?? [] : [];
    const playerById = new Map(players.map(player => [player.id, player]));
    const contractByPlayerId = new Map(contracts.map(contract => [contract.player_id, contract]));
    const rightsByPlayerId = new Map<string, typeof rights>();
    rights.forEach(right => rightsByPlayerId.set(right.player_id, [...(rightsByPlayerId.get(right.player_id) ?? []), right]));
    return { franchise, players: assignments.map(assignment => ({ ...assignment, player: playerById.get(assignment.player_id) ?? null, contract: contractByPlayerId.get(assignment.player_id) ?? null, rights: rightsByPlayerId.get(assignment.player_id) ?? [] })) };
  }),

  playerDirectory: publicProcedure.query(async () => {
    const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").order("display_name").limit(250)) ?? [];
    return players;
  }),

  freeAgents: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(150).optional() }).optional()).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const limit = input?.limit ?? 75;
    let playerQuery = supabase.from("player").select("id, provider, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").order("display_name").limit(limit + 220);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position);
    const [playersResult, activeAssignmentsResult] = await Promise.all([
      playerQuery,
      supabase.from("roster_assignment").select("player_id").eq("season_id", season.id).is("released_at", null),
    ]);
    const players = unwrap(playersResult) ?? [];
    const activePlayerIds = new Set((unwrap(activeAssignmentsResult) ?? []).map(assignment => assignment.player_id));
    const rosteredPlayers = activePlayerIds.size ? unwrap(await supabase.from("player").select("display_name").in("id", Array.from(activePlayerIds))) ?? [] : [];
    const activePlayerNames = new Set(rosteredPlayers.map(player => player.display_name.trim().toLowerCase().replace(/\s+/g, " ")));
    return players.filter(player => !activePlayerIds.has(player.id) && !activePlayerNames.has(player.display_name.trim().toLowerCase().replace(/\s+/g, " "))).slice(0, limit);
  }),

  playerDetail: publicProcedure.input(z.object({ playerId: z.string().uuid() })).query(async ({ input }) => {
    const player = unwrap(await supabase.from("player").select("id, provider, external_id, display_name, position, nfl_team, status, metadata, created_at, updated_at").eq("id", input.playerId).maybeSingle());
    if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    return player;
  }),

  nflProviderStatus: publicProcedure.query(async () => getNFLDataAdapter().status()),

  fantasyProsCacheStatus: publicProcedure.query(async () => fantasyProsCacheStatus()),

  refreshFantasyProsPlayers: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const adapter = getFantasyProsDataAdapter();
    if (!adapter) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    const snapshot = await adapter.listPlayerSnapshot();
    const payloadCount = Array.isArray(snapshot.payload) ? snapshot.payload.length : Array.isArray((snapshot.payload as { players?: unknown[] })?.players) ? ((snapshot.payload as { players: unknown[] }).players.length) : null;
    return { provider: snapshot.provider, source: snapshot.source, fetchedAt: snapshot.fetchedAt, expiresAt: snapshot.expiresAt, playerCount: payloadCount, lastError: snapshot.lastError };
  }),

  syncFantasyProsPlayers: protectedProcedure.mutation(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const adapter = getFantasyProsDataAdapter();
    if (!adapter) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FantasyPros is not configured for CVC." });
    return syncFantasyProsSnapshot(await adapter.listPlayerSnapshot());
  }),

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
    const assignment = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle());
    if (!assignment) throw new TRPCError({ code: "NOT_FOUND", message: "This player is not on the active CVC roster." });
    const contract = unwrap(await supabase.from("player_contract").select("id, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle());
    if (!contract || ["released", "expired"].includes(contract.contract_status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active CVC contract can be released from Protections." });
    }
    const player = unwrap(await supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle());

    unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("id", assignment.id).select("id").single());
    unwrap(await supabase.from("player_contract").update({ contract_status: "released" }).eq("id", contract.id).select("id").single());
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
    const [assignment, contract, player, activeRights, franchiseTags] = await Promise.all([
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle(),
      supabase.from("player_contract").select("id, salary, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("player_right").select("id, right_type").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active"),
      supabase.from("player_right").select("player_id, salary_basis, metadata").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("right_type", "franchise").eq("status", "active"),
    ]);
    const activeAssignment = unwrap(assignment); const activeContract = unwrap(contract); const playerRow = unwrap(player);
    const existingRights = unwrap(activeRights) ?? []; const existingFranchiseTags = unwrap(franchiseTags) ?? [];
    if (!activeAssignment || !activeContract || ["released", "expired"].includes(activeContract.contract_status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active rostered contract can receive a franchise tag." });
    if (existingRights.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Remove or resolve the player’s current protection right before assigning a franchise tag." });
    const currentSalary = Number(activeContract.salary);
    const salary = currentSalary + 1;
    const tier = salary < 10 ? "under_10" : "at_or_above_10";
    const requiredYears = tier === "under_10" ? 2 : 3;
    if (input.contractYears !== requiredYears) throw new TRPCError({ code: "BAD_REQUEST", message: `${tier === "under_10" ? "Under-$10" : "$10-and-over"} franchise designations require a ${requiredYears}-year term under CVC rules.` });
    if (existingFranchiseTags.some(tag => {
      const metadata = (tag.metadata ?? {}) as { tier?: string };
      const existingTier = metadata.tier ?? (Number(tag.salary_basis) + 1 < 10 ? "under_10" : "at_or_above_10");
      return existingTier === tier;
    })) throw new TRPCError({ code: "BAD_REQUEST", message: `This franchise already has its ${tier === "under_10" ? "under-$10" : "$10-and-over"} franchise designation.` });
    const expiresYear = season.year + requiredYears - 1;
    unwrap(await supabase.from("player_contract").update({ salary, expires_year: expiresYear, contract_status: "active" }).eq("id", activeContract.id).select("id").single());
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: "franchise", salary_basis: currentSalary, contract_years: input.contractYears, expires_year: expiresYear, metadata: { tier, designated_season: season.year, tagged_salary: salary } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the franchise designation." });
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} assigned a ${input.contractYears}-year franchise tag to ${playerRow?.display_name ?? "a player"}.`, details: { player_id: input.playerId, right_type: "franchise", tier, salary, contract_years: input.contractYears } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "franchise_tag_assigned", `${franchise.name} assigned a ${input.contractYears}-year ${tier} franchise tag to ${playerRow?.display_name ?? "a player"}.`);
    return { rightId: right.id, salary, expiresYear };
  }),

  assignTransitionTag: protectedProcedure.input(z.object({ franchiseId: z.string().uuid(), playerId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const actor = await getOwnerAccess({ openId: ctx.user.openId });
    if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to assign a transition tag." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name, current_owner_id").eq("id", input.franchiseId).eq("league_id", league.id).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    if (franchise.current_owner_id !== actor.id && !["commissioner", "administrator"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You may only assign a transition tag for your own CVC franchise." });
    const [assignment, contract, player, activeRights, priorTransition] = await Promise.all([
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).is("released_at", null).maybeSingle(),
      supabase.from("player_contract").select("id, salary, contract_status").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).maybeSingle(),
      supabase.from("player").select("display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("player_right").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.playerId).eq("status", "active"),
      supabase.from("player_right").select("id").eq("player_id", input.playerId).eq("right_type", "transition").limit(1),
    ]);
    const activeAssignment = unwrap(assignment); const activeContract = unwrap(contract); const playerRow = unwrap(player);
    if (!activeAssignment || !activeContract || ["released", "expired"].includes(activeContract.contract_status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only an active rostered contract can receive a transition tag." });
    if ((unwrap(activeRights) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Remove or resolve the player’s current protection right before assigning a transition tag." });
    if ((unwrap(priorTransition) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "This player has already used a transition designation and cannot be transitioned again." });
    const currentSalary = Number(activeContract.salary); const salary = currentSalary < 10 ? currentSalary * 2 : currentSalary + 10;
    unwrap(await supabase.from("player_contract").update({ salary, expires_year: season.year, contract_status: "expiring" }).eq("id", activeContract.id).select("id").single());
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: "transition", salary_basis: currentSalary, contract_years: 1, expires_year: season.year, metadata: { transition_exhausted: true, designated_season: season.year, tagged_salary: salary } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the transition designation." });
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} assigned a transition tag to ${playerRow?.display_name ?? "a player"}.`, details: { player_id: input.playerId, right_type: "transition", salary } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "transition_tag_assigned", `${franchise.name} assigned a one-year transition tag to ${playerRow?.display_name ?? "a player"}.`);
    return { rightId: right.id, salary, expiresYear: season.year };
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
    if (input.rightType === "waiver_match" && !wasWaiverAcquired && !input.waiverEligibilityOverride) throw new TRPCError({ code: "BAD_REQUEST", message: "A waiver matching right requires a recorded CVC waiver or free-agent acquisition, or commissioner-reviewed legacy eligibility." });
    if (input.rightType === "waiver_match" && (unwrap(waiverRights) ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Each franchise may hold one active waiver matching right per season." });
    const waiverEligibilitySource = wasWaiverAcquired ? "recorded_transaction" : input.waiverEligibilityOverride ? "commissioner_review" : null;
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: input.rightType, salary_basis: Number(activeContract.salary), expires_year: activeContract.expires_year ?? season.year, metadata: { original_franchise_id: franchise.id, designated_season: season.year, source_marker: activeContract.source_marker, waiver_eligibility_source: waiverEligibilitySource } }).select("id").single());
    if (!right) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC could not save the restricted right." });
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "note", status: "final", summary: `${franchise.name} designated ${playerRow?.display_name ?? "a player"} for ${input.rightType === "rookie_match" ? "rookie" : "waiver"} matching rights.`, details: { player_id: input.playerId, right_type: input.rightType } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "player_right", right.id, "restricted_right_assigned", `${franchise.name} assigned ${input.rightType} to ${playerRow?.display_name ?? "a player"}.`);
    return { rightId: right.id, rightType: input.rightType };
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
