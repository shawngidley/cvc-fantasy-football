import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getFantasyProsDataAdapter, getNFLDataAdapter } from "../nflDataAdapter";
import { fantasyProsCacheStatus } from "../fantasyProsCache";
import { syncFantasyProsSnapshot } from "../fantasyProsSync";
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
  const season = unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season configuration was not found." });
  return { league, season };
}

async function createAuditEvent(leagueId: string, seasonId: string, actorOwnerId: string, entityType: string, entityId: string | null, action: string, summary: string) {
  unwrap(await supabase.from("audit_event").insert({ league_id: leagueId, season_id: seasonId, actor_owner_id: actorOwnerId, entity_type: entityType, entity_id: entityId, action, summary }).select("id").single());
}

export const leagueRouter = router({
  overview: publicProcedure.query(async () => {
    const [league, season, franchises, owners, weeks, matchups, financialEntries] = await Promise.all([
      supabase.from("league").select("id, slug, name, short_name, timezone, primary_color, accent_color").eq("slug", "cvc-auction-football").single(),
      supabase.from("season").select("id, year, label, status, regular_season_weeks, playoff_teams").order("year", { ascending: false }).limit(1).single(),
      supabase.from("franchise").select("id, name, abbreviation, division_name, current_owner_id, brand_color, logo_url, display_order").eq("is_active", true).order("display_order"),
      supabase.from("owner").select("id, display_name, role").eq("is_active", true),
      supabase.from("schedule_week").select("id, week_number, label, status").order("week_number"),
      supabase.from("matchup").select("id, schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, home_projection, away_projection, result_state").order("created_at"),
      supabase.from("league_financial_entry").select("franchise_id, entry_type, amount, status").order("created_at"),
    ]);

    const leagueData = unwrap(league);
    const seasonData = unwrap(season);
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
    const { data: season, error: seasonError } = await supabase.from("season").select("id").order("year", { ascending: false }).limit(1).single();
    if (seasonError || !season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season configuration was not found." });
    const { data, error } = await supabase.from("transaction").select("id, transaction_type, status, summary, occurred_at, details, franchise:franchise_id(name, is_active)").eq("season_id", season.id).order("occurred_at", { ascending: false }).limit(50);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    const legacySummary = /atlas aces|harbor hounds|placeholder/i;
    return (data ?? []).filter((item: any) => {
      const franchise = Array.isArray(item.franchise) ? item.franchise[0] : item.franchise;
      return franchise?.is_active !== false && !legacySummary.test(item.summary ?? "");
    }).map((item: any) => {
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
    const { data: draft, error: draftError } = await supabase.from("draft").select("id, label, draft_type, status, pick_timer_seconds, keeper_enabled, lottery_enabled, settings").limit(1).single();
    if (draftError || !draft) throw new TRPCError({ code: "NOT_FOUND", message: "CVC draft configuration was not found." });
    const [picksResult, franchisesResult] = await Promise.all([
      supabase.from("draft_pick").select("id, round_number, pick_number, original_franchise_id, current_franchise_id, pick_status, is_protected, notes").eq("draft_id", draft.id).order("pick_number").limit(500),
      supabase.from("franchise").select("id, name, abbreviation, logo_url").eq("is_active", true).limit(100),
    ]);
    const picks = unwrap(picksResult) ?? [];
    const franchises = unwrap(franchisesResult) ?? [];
    const franchiseById = new Map(franchises.map(franchise => [franchise.id, franchise]));
    return { ...draft, picks: picks.map(pick => ({ ...pick, originalFranchise: franchiseById.get(pick.original_franchise_id)?.name ?? "Unknown", currentFranchise: franchiseById.get(pick.current_franchise_id)?.name ?? "Unknown" })) };
  }),

  saveDraft: protectedProcedure.input(z.object({ label: z.string().min(2).max(100), draftType: z.enum(["snake", "linear", "auction", "rookie", "supplemental"]), status: z.enum(["setup", "lottery", "live", "paused", "complete"]), pickTimerSeconds: z.number().int().min(0).max(7200).nullable().optional(), lotteryEnabled: z.boolean(), startsAt: z.string().datetime().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const draft = unwrap(await supabase.from("draft").upsert({ season_id: season.id, label: input.label, draft_type: input.draftType, status: input.status, pick_timer_seconds: input.pickTimerSeconds ?? null, lottery_enabled: input.lotteryEnabled, starts_at: input.startsAt ?? null, updated_at: new Date().toISOString() }, { onConflict: "season_id" }).select("id, label, draft_type, status").single());
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

  recordDraftSelection: protectedProcedure.input(z.object({ draftPickId: z.string().uuid(), playerId: z.string().uuid(), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId }); const { league, season } = await getCurrentLeagueAndSeason();
    const pick = unwrap(await supabase.from("draft_pick").select("id, draft_id, current_franchise_id, pick_number, pick_status, draft:draft_id(season_id, draft_type)").eq("id", input.draftPickId).maybeSingle());
    if (!pick || pick.draft?.[0]?.season_id !== season.id || pick.pick_status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This CVC draft pick is not available for selection." });
    if (!['rookie', 'supplemental'].includes(pick.draft?.[0]?.draft_type ?? '')) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC player selection is reserved for rookie or supplemental drafts." });
    const player = unwrap(await supabase.from("player").select("id, display_name, metadata").eq("id", input.playerId).maybeSingle()); if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    if (!(player.metadata as Record<string, unknown> | null)?.rookie) throw new TRPCError({ code: "BAD_REQUEST", message: "Only players marked as rookies are eligible for the CVC rookie draft." });
    const active = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", player.id).is("released_at", null).limit(1).maybeSingle()); if (active) throw new TRPCError({ code: "BAD_REQUEST", message: "This rookie is already on a CVC roster." });
    unwrap(await supabase.from("draft_pick").update({ player_id: player.id, pick_status: "selected", selected_at: new Date().toISOString(), notes: input.note ?? null }).eq("id", pick.id).select("id").single());
    unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: pick.current_franchise_id, player_id: player.id, roster_state: "active" }).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: pick.current_franchise_id, actor_owner_id: commissioner.id, transaction_type: "draft_pick", status: "final", summary: `CVC rookie draft pick ${pick.pick_number}: ${player.display_name}`, details: { draft_pick_id: pick.id, player_id: player.id } }).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "draft_pick", pick.id, "selected", `Recorded CVC rookie draft selection ${player.display_name}.`); return { selected: true };
  }),

  franchiseRoster: publicProcedure.input(z.object({ franchiseId: z.string().uuid() })).query(async ({ input }) => {
    const { data: franchise, error: franchiseError } = await supabase.from("franchise").select("id, name, abbreviation, division_name, brand_color, logo_url, current_owner_id").eq("id", input.franchiseId).single();
    if (franchiseError || !franchise) throw new TRPCError({ code: "NOT_FOUND", message: "CVC franchise was not found." });
    const { data: season, error: seasonError } = await supabase.from("season").select("id, year").order("year", { ascending: false }).limit(1).single();
    if (seasonError || !season) throw new TRPCError({ code: "NOT_FOUND", message: "CVC season was not found." });
    const assignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, roster_state, assigned_slot_code, acquired_at").eq("season_id", season.id).eq("franchise_id", franchise.id).is("released_at", null).order("acquired_at")) ?? [];
    const releasedAssignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, released_at").eq("season_id", season.id).eq("franchise_id", franchise.id).not("released_at", "is", null).order("released_at", { ascending: false })) ?? [];
    const playerIds = assignments.map(item => item.player_id);
    const releasedPlayerIds = releasedAssignments.map(item => item.player_id);
    const players = playerIds.length ? unwrap(await supabase.from("player").select("id, display_name, position, nfl_team, status").in("id", playerIds)) ?? [] : [];
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
        } else {
          actions.push("cut");
          if (expiring) {
            const termTier = cvcContractTier(Number(contract.salary), contract.source_marker);
            const highTransition = history.some(isCvcHighSalaryTransition); const hasTransition = history.some(right => right.right_type === "transition"); const hasFranchise = history.some(right => right.right_type === "franchise");
            if (!highTransition && (termTier === "two_year" ? !twoYearTagTaken : !threeYearTagTaken)) actions.push(termTier === "two_year" ? "franchise_2" : "franchise_3");
            if (!hasTransition && !hasFranchise) actions.push("transition");
            if (marker === "W") actions.push("waiver_match");
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

  playerDirectory: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(150).optional() }).optional()).query(async ({ input }) => {
    const limit = input?.limit ?? 75;
    let query = supabase.from("player").select("id, display_name, position, nfl_team, status, metadata").order("display_name").limit(limit);
    if (input?.search) query = query.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) query = query.eq("position", input.position);
    const players = unwrap(await query) ?? [];
    return players;
  }),

  freeAgents: publicProcedure.input(z.object({ search: z.string().trim().max(64).optional(), position: z.string().trim().max(12).optional(), limit: z.number().int().min(1).max(150).optional() }).optional()).query(async ({ input }) => {
    const { season } = await getCurrentLeagueAndSeason();
    const limit = input?.limit ?? 75;
    const eligiblePositions = ["QB", "RB", "WR", "TE", "K", "DST"];
    if (input?.position && !eligiblePositions.includes(input.position.toUpperCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC Free Agents are limited to QB, RB, WR, TE, K, and D/ST." });
    let playerQuery = supabase.from("player").select("id, provider, display_name, position, nfl_team, status, metadata").neq("provider", "placeholder").in("position", eligiblePositions).order("display_name").limit(limit + 220);
    if (input?.search) playerQuery = playerQuery.ilike("display_name", `%${input.search.replace(/[%_]/g, "")}%`);
    if (input?.position) playerQuery = playerQuery.eq("position", input.position.toUpperCase());
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
    const { season } = await getCurrentLeagueAndSeason();
    const assignment = unwrap(await supabase.from("roster_assignment").select("franchise_id, acquired_at, assigned_slot_code").eq("season_id", season.id).eq("player_id", player.id).eq("roster_state", "active").is("released_at", null).maybeSingle());
    const contract = assignment ? unwrap(await supabase.from("player_contract").select("salary, expires_year, source_marker, contract_status").eq("season_id", season.id).eq("franchise_id", assignment.franchise_id).eq("player_id", player.id).maybeSingle()) : null;
    const franchise = assignment ? unwrap(await supabase.from("franchise").select("id, name, owner_id").eq("id", assignment.franchise_id).maybeSingle()) : null;
    const owner = franchise ? unwrap(await supabase.from("owner").select("display_name").eq("id", franchise.owner_id).maybeSingle()) : null;
    return {
      ...player,
      season: { id: season.id, year: season.year },
      ownership: franchise ? { franchiseId: franchise.id, franchiseName: franchise.name, ownerName: owner?.display_name ?? null, acquiredAt: assignment?.acquired_at ?? null, assignedSlotCode: assignment?.assigned_slot_code ?? null } : null,
      contract,
    };
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

  waiverStatus: publicProcedure.query(async () => {
    const { season } = await getCurrentLeagueAndSeason();
    const now = new Date().toISOString();
    const period = unwrap(await supabase.from("waiver_period").select("id, label, opens_at, closes_at, status").eq("season_id", season.id).eq("status", "open").lte("opens_at", now).gte("closes_at", now).order("closes_at").limit(1).maybeSingle());
    return { period };
  }),

  createWaiverPeriod: protectedProcedure.input(z.object({ label: z.string().min(2).max(100), opensAt: z.string().datetime(), closesAt: z.string().datetime() }).refine(value => new Date(value.closesAt) > new Date(value.opensAt), { message: "A waiver period must close after it opens." })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const period = unwrap(await supabase.from("waiver_period").insert({ season_id: season.id, label: input.label, opens_at: input.opensAt, closes_at: input.closesAt, status: "open" }).select("id, label, opens_at, closes_at, status").single());
    if (!period) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC waiver period could not be created." });
    await createAuditEvent(league.id, season.id, commissioner.id, "waiver_period", period.id, "created", `Opened waiver period ${period.label}`);
    return period;
  }),

  submitFaabBid: protectedProcedure.input(z.object({ playerId: z.string().uuid(), amount: z.number().int().min(0).max(10000), priority: z.number().int().min(1).max(99).default(1), dropPlayerId: z.string().uuid().optional() })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to submit a waiver claim." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const franchise = unwrap(await supabase.from("franchise").select("id, name").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!franchise) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner with an active CVC franchise may submit a waiver claim." });
    const now = new Date().toISOString();
    const period = unwrap(await supabase.from("waiver_period").select("id, label").eq("season_id", season.id).eq("status", "open").lte("opens_at", now).gte("closes_at", now).order("closes_at").limit(1).maybeSingle());
    if (!period) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There is no open CVC waiver period." });
    const [player, activeAssignment] = await Promise.all([
      supabase.from("player").select("id, display_name").eq("id", input.playerId).maybeSingle(),
      supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", input.playerId).is("released_at", null).limit(1).maybeSingle(),
    ]);
    const playerRow = unwrap(player);
    if (!playerRow) throw new TRPCError({ code: "NOT_FOUND", message: "CVC player was not found." });
    if (unwrap(activeAssignment)) throw new TRPCError({ code: "BAD_REQUEST", message: "Rostered players cannot be claimed through waivers." });
    if (input.dropPlayerId) {
      const drop = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("franchise_id", franchise.id).eq("player_id", input.dropPlayerId).is("released_at", null).maybeSingle());
      if (!drop) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected drop player is not on your active CVC roster." });
    }
    const bid = unwrap(await supabase.from("faab_bid").upsert({ waiver_period_id: period.id, franchise_id: franchise.id, player_id: input.playerId, drop_player_id: input.dropPlayerId ?? null, amount: input.amount, priority: input.priority, status: "pending" }, { onConflict: "waiver_period_id,franchise_id,player_id" }).select("id, amount, priority, status").single());
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

  waiverBidQueue: protectedProcedure.query(async ({ ctx }) => {
    await requireCommissioner({ openId: ctx.user.openId });
    const { season } = await getCurrentLeagueAndSeason();
    const periodIds = (unwrap(await supabase.from("waiver_period").select("id").eq("season_id", season.id)) ?? []).map(period => period.id);
    if (!periodIds.length) return [];
    return unwrap(await supabase.from("faab_bid").select("id, amount, priority, status, submitted_at, player:player_id(id, display_name, position, nfl_team), franchise:franchise_id(id, name), period:waiver_period_id(id, label, closes_at, status)").in("waiver_period_id", periodIds).eq("status", "pending").order("amount", { ascending: false }).order("priority").limit(200)) ?? [];
  }),

  resolveFaabBid: protectedProcedure.input(z.object({ bidId: z.string().uuid(), outcome: z.enum(["won", "lost"]) })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const bid = unwrap(await supabase.from("faab_bid").select("id, waiver_period_id, franchise_id, player_id, drop_player_id, amount, status, player:player_id(display_name), franchise:franchise_id(name)").eq("id", input.bidId).maybeSingle());
    if (!bid) throw new TRPCError({ code: "NOT_FOUND", message: "CVC waiver bid was not found." });
    if (bid.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending CVC waiver bids may be resolved." });
    if (input.outcome === "won") {
      const active = unwrap(await supabase.from("roster_assignment").select("id").eq("season_id", season.id).eq("player_id", bid.player_id).is("released_at", null).limit(1).maybeSingle());
      if (active) throw new TRPCError({ code: "BAD_REQUEST", message: "This player is no longer available for a CVC waiver award." });
      if (bid.drop_player_id) unwrap(await supabase.from("roster_assignment").update({ roster_state: "released", released_at: new Date().toISOString() }).eq("season_id", season.id).eq("franchise_id", bid.franchise_id).eq("player_id", bid.drop_player_id).is("released_at", null).select("id"));
      unwrap(await supabase.from("roster_assignment").insert({ season_id: season.id, franchise_id: bid.franchise_id, player_id: bid.player_id, roster_state: "waivers" }).select("id").single());
      unwrap(await supabase.from("faab_bid").update({ status: "lost", resolved_at: new Date().toISOString() }).eq("waiver_period_id", bid.waiver_period_id).eq("player_id", bid.player_id).eq("status", "pending").neq("id", bid.id).select("id"));
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
    let query = supabase.from("trade_offer").select("id, status, note, proposed_at, responded_at, reviewed_at, proposer:proposer_franchise_id(id, name), recipient:recipient_franchise_id(id, name), assets:trade_asset(id, from_franchise_id, player:player_id(id, display_name, position, nfl_team))").eq("season_id", season.id).order("proposed_at", { ascending: false }).limit(100);
    if (franchise) query = query.or(`proposer_franchise_id.eq.${franchise.id},recipient_franchise_id.eq.${franchise.id}`);
    return unwrap(await query) ?? [];
  }),

  proposeTrade: protectedProcedure.input(z.object({ recipientFranchiseId: z.string().uuid(), offerPlayerIds: z.array(z.string().uuid()).min(1).max(22), requestPlayerIds: z.array(z.string().uuid()).min(1).max(22), note: z.string().trim().max(500).optional() }).refine(value => new Set([...value.offerPlayerIds, ...value.requestPlayerIds]).size === value.offerPlayerIds.length + value.requestPlayerIds.length, { message: "A player may appear only once in a CVC trade proposal." })).mutation(async ({ ctx, input }) => {
    const owner = await getOwnerAccess({ openId: ctx.user.openId });
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "A CVC owner session is required to propose a trade." });
    const { league, season } = await getCurrentLeagueAndSeason();
    const proposer = unwrap(await supabase.from("franchise").select("id, name").eq("current_owner_id", owner.id).eq("is_active", true).limit(1).maybeSingle());
    if (!proposer) throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner with an active CVC franchise may propose a trade." });
    if (proposer.id === input.recipientFranchiseId) throw new TRPCError({ code: "BAD_REQUEST", message: "A CVC franchise cannot propose a trade to itself." });
    const recipient = unwrap(await supabase.from("franchise").select("id, name").eq("id", input.recipientFranchiseId).eq("is_active", true).maybeSingle());
    if (!recipient) throw new TRPCError({ code: "NOT_FOUND", message: "The recipient CVC franchise was not found." });
    const playerIds = [...input.offerPlayerIds, ...input.requestPlayerIds];
    const assignments = unwrap(await supabase.from("roster_assignment").select("player_id, franchise_id").eq("season_id", season.id).in("player_id", playerIds).is("released_at", null)) ?? [];
    const ownerByPlayer = new Map(assignments.map(assignment => [assignment.player_id, assignment.franchise_id]));
    if (input.offerPlayerIds.some(playerId => ownerByPlayer.get(playerId) !== proposer.id) || input.requestPlayerIds.some(playerId => ownerByPlayer.get(playerId) !== recipient.id)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every CVC trade player must be on the franchise offering that player." });
    const trade = unwrap(await supabase.from("trade_offer").insert({ season_id: season.id, proposer_franchise_id: proposer.id, recipient_franchise_id: recipient.id, note: input.note ?? null }).select("id").single());
    if (!trade) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC trade proposal could not be saved." });
    const assets = [
      ...input.offerPlayerIds.map(player_id => ({ trade_offer_id: trade.id, from_franchise_id: proposer.id, player_id })),
      ...input.requestPlayerIds.map(player_id => ({ trade_offer_id: trade.id, from_franchise_id: recipient.id, player_id })),
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
    const updated = unwrap(await supabase.from("trade_offer").update({ status: input.response, responded_at: new Date().toISOString() }).eq("id", trade.id).select("id, status").single());
    await createAuditEvent(league.id, season.id, owner.id, "trade_offer", trade.id, input.response, `CVC trade proposal was ${input.response}.`);
    return updated;
  }),

  executeTrade: protectedProcedure.input(z.object({ tradeId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const commissioner = await requireCommissioner({ openId: ctx.user.openId });
    const { league, season } = await getCurrentLeagueAndSeason();
    const trade = unwrap(await supabase.from("trade_offer").select("id, proposer_franchise_id, recipient_franchise_id, status, proposer:proposer_franchise_id(name), recipient:recipient_franchise_id(name), assets:trade_asset(id, from_franchise_id, player_id)").eq("id", input.tradeId).eq("season_id", season.id).maybeSingle());
    if (!trade || trade.status !== "accepted") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an accepted CVC trade may be executed." });
    const assets = trade.assets ?? [];
    const assignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, franchise_id").eq("season_id", season.id).in("player_id", assets.map((asset: any) => asset.player_id)).is("released_at", null)) ?? [];
    const assignmentByPlayer = new Map(assignments.map(assignment => [assignment.player_id, assignment]));
    if (assets.some((asset: any) => assignmentByPlayer.get(asset.player_id)?.franchise_id !== asset.from_franchise_id)) throw new TRPCError({ code: "CONFLICT", message: "A CVC trade asset is no longer on its offering franchise roster." });
    await Promise.all(assets.map(async (asset: any) => {
      const destination = asset.from_franchise_id === trade.proposer_franchise_id ? trade.recipient_franchise_id : trade.proposer_franchise_id;
      await Promise.all([
        supabase.from("roster_assignment").update({ franchise_id: destination, roster_state: "active", updated_at: new Date().toISOString() }).eq("id", assignmentByPlayer.get(asset.player_id)!.id).select("id"),
        supabase.from("player_contract").update({ franchise_id: destination }).eq("season_id", season.id).eq("franchise_id", asset.from_franchise_id).eq("player_id", asset.player_id).select("id"),
        supabase.from("player_right").update({ status: "expired" }).eq("season_id", season.id).eq("franchise_id", asset.from_franchise_id).eq("player_id", asset.player_id).in("right_type", ["franchise", "transition"]).eq("status", "active").select("id"),
      ]);
    }));
    unwrap(await supabase.from("trade_offer").update({ status: "processed", reviewed_at: new Date().toISOString(), reviewed_by_owner_id: commissioner.id }).eq("id", trade.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: trade.proposer_franchise_id, actor_owner_id: commissioner.id, transaction_type: "trade", status: "final", summary: `${trade.proposer?.[0]?.name ?? "CVC franchise"} completed a trade with ${trade.recipient?.[0]?.name ?? "CVC franchise"}.`, details: { trade_offer_id: trade.id, asset_count: assets.length } }).select("id").single());
    await createAuditEvent(league.id, season.id, commissioner.id, "trade_offer", trade.id, "processed", "Commissioner executed an accepted CVC trade.");
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
    const slot = unwrap(await supabase.from("roster_slot").select("code, label, eligible_positions, maximum_count").eq("season_id", season.id).eq("code", input.slotCode).maybeSingle());
    if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "That CVC roster slot is not configured for this season." });
    const player = assignment.player?.[0];
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
    unwrap(await supabase.from("player_contract").update({ salary, expires_year: season.year, source_marker: "T", contract_status: "expiring" }).eq("id", activeContract.id).select("id").single());
    const right = unwrap(await supabase.from("player_right").insert({ season_id: season.id, franchise_id: franchise.id, player_id: input.playerId, right_type: "transition", salary_basis: priorSeasonSalary, contract_years: 1, expires_year: season.year, metadata: { transition_exhausted: true, transition_tier: transitionTier, designated_season: season.year, prior_season_salary: priorSeasonSalary, tagged_salary: salary, future_franchise_allowed: transitionTier === "two_year", previous_salary: currentSalary, previous_expires_year: activeContract.expires_year, previous_source_marker: activeContract.source_marker, previous_contract_status: activeContract.contract_status } }).select("id").single());
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
    unwrap(await supabase.from("player_contract").update({ contract_status: Number(contract.expires_year) <= season.year ? "expiring" : "active" }).eq("id", contract.id).select("id").single());
    unwrap(await supabase.from("transaction").insert({ season_id: season.id, franchise_id: franchise.id, actor_owner_id: actor.id, transaction_type: "add", status: "final", summary: `${franchise.name} restored ${player?.display_name ?? "a player"} from Protections.`, details: { player_id: input.playerId, action: "cut_restored" } }).select("id").single());
    await createAuditEvent(league.id, season.id, actor.id, "roster_assignment", assignment.id, "cut_restored", `${franchise.name} restored ${player?.display_name ?? "a player"} from Protections.`);
    return { restored: true };
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
