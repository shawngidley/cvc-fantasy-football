import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getNFLDataAdapter, Tank01NFLDataAdapter, type Tank01BoxScore } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";
import { resolveSkinForWeek } from "./cvcSkins";
import { promotePlannedLineupForWeek } from "./plannedLineup";
import { mapWithConcurrencyLimit, normalizeTeam, resolveStatLine, type SnapshotRow } from "./cvcScoringShared";
import { normalizePlayerName } from "@shared/playerNameMatch";
import { getKickerEventsForPlayer, parseEspnKickerEvents, sumMadeFieldGoalYards, countMadeExtraPoints, type KickerPlayEvent } from "@shared/espnKickerEvents";
import { persistWeeklyStats, refreshSeasonStatsCurrent, type WeeklyStatPlayer } from "./cvcPlayerWeeklyStats";

export { normalizeTeam };

/** Whether a single game is actually done, based on its own box score's
 * gameStatusCode -- confirmed directly with Tank01 (same finding already applied in
 * WRC): getNFLBoxScore's gameStatus/gameStatusCode fields ARE genuinely live, unlike
 * getNFLGamesForWeek's stale, once-daily-refreshed schedule endpoint. gameStatusCode
 * is a clean numeric enum (0=not started, 1=in progress, 2=final/completed,
 * 3=postponed, 4=suspended), checked as a string here since its exact wire type isn't
 * confirmed; falls back to the gameStatus text itself for defense-in-depth in case
 * that field is ever missing or an unexpected type. */
export function isGameFinal(body: { gameStatus?: unknown; gameStatusCode?: unknown } | null | undefined): boolean {
  const code = body?.gameStatusCode !== undefined ? String(body.gameStatusCode) : undefined;
  if (code !== undefined) return code === "2";
  return /final|completed/i.test(String(body?.gameStatus ?? ""));
}

/** Whether a CVC week should be finalized: every game scheduled for this week must
 * have actually kicked off AND genuinely finished (per isGameFinal on each one's own
 * box score) -- no time-based cutoff at all. This replaces an earlier calendar-based
 * approach (a hardcoded "Friday 4pm UTC" correction window) that wasn't actually
 * checking whether the games were done, only whether enough calendar time had passed
 * that they probably were -- resulting in a multi-day gap where a week's games were
 * long over but the week still showed as "live" and didn't count toward standings.
 * Confirmed with the commissioner that CVC should behave like WRC here: finalize as
 * soon as every game is actually final, not on a fixed calendar delay.
 *
 * totalScheduledGames must equal gameStatuses.length -- gameStatuses only ever has an
 * entry per game that's already kicked off (a box score for a game that hasn't started
 * doesn't exist to check), so without this check, a week where only some games have
 * even started yet -- and those few happen to already be done -- would incorrectly
 * finalize while games that haven't begun are still ahead. */
export function shouldFinalizeWeek(totalScheduledGames: number, gameStatuses: boolean[]): boolean {
  if (totalScheduledGames === 0 || gameStatuses.length !== totalScheduledGames) return false;
  return gameStatuses.every(isFinal => isFinal);
}

/** Whether a game's kickoff has already passed. Same Date.UTC()-based approach as the
 * client-side computeKickoffUtc (see useCvcTank01LiveScores.ts) -- a string-interpolated
 * "...T${hour}:00Z" timestamp silently produces an Invalid Date for any 8pm+ local
 * kickoff (hour + 4 overflows past 23), so this is built the same correct way.
 * Confirmed as a real, previously-ungated source of API usage: this function's caller
 * (this cron, running every 5 minutes for the entire CVC week regardless of actual game
 * timing) was fetching a box score for every game in the week on every single run --
 * including games days in the future that hadn't kicked off yet at all. */
export function hasKickedOff(gameDate?: string, gameTime?: string): boolean {
  if (!gameDate || !gameTime || gameDate.length < 8) return false;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return false;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  const kickoffUtc = Date.UTC(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)) - 1, Number(gameDate.slice(6, 8)), hour + 4, Number(time[2]), 0);
  return Date.now() >= kickoffUtc;
}

export type Tank01SyncSummary = {
  status: "skipped" | "updated" | "finalized";
  weekLabel?: string;
  matchupsUpdated: number;
  reason?: string;
};




/** Picks which week syncTank01Scores should operate on. Normal path (no
 * forceWeekNumber): only ever selects a "live" or "upcoming" week -- once a week's
 * status flips to "final" it can never be selected here again, which is exactly the
 * gap confirmed by the finalization audit (item 9): if a scoring bug is fixed AFTER a
 * week has already finalized, simply re-running this sync does nothing for that
 * week -- it silently moves on to whatever the next live/upcoming week is instead.
 * forceWeekNumber bypasses that filter entirely, selecting the named week regardless
 * of its current status, so a commissioner has a way to actually reach a week that's
 * already final. */
export function selectWeekForSync<T extends { week_number: number; status: string }>(weeks: T[], forceWeekNumber?: number): T | null {
  if (forceWeekNumber !== undefined) return weeks.find(item => item.week_number === forceWeekNumber) ?? null;
  return weeks.find(item => item.status === "live") ?? weeks.find(item => item.status === "upcoming") ?? null;
}

async function currentContext(forceWeekNumber?: number) {
  // Prefer the explicitly-flagged current season (see season.is_current migration) --
  // neither `year` nor `status` can safely identify it once a future season row exists
  // (e.g. to hold next year's tradeable rookie picks). Falls back to the old highest-
  // year behavior only if no season is flagged yet.
  const flagged = unwrap(await supabase.from("season").select("id, league_id, year").eq("is_current", true).limit(1).maybeSingle());
  const season = flagged ?? unwrap(await supabase.from("season").select("id, league_id, year").order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new Error("No CVC season is available for Tank01 scoring synchronization.");
  const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number, label, status").eq("season_id", season.id).order("week_number")) ?? [];
  const week = selectWeekForSync(weeks, forceWeekNumber);
  return { season, week, weeks };
}

async function snapshotLineups(seasonId: string, weekId: string, franchiseIds: string[]) {
  const existing = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, player_id").eq("schedule_week_id", weekId)) ?? [];
  if (existing.length) return;
  const assignments = unwrap(await supabase.from("roster_assignment").select("id, franchise_id, player_id, assigned_slot_code").eq("season_id", seasonId).in("franchise_id", franchiseIds).is("released_at", null).not("assigned_slot_code", "is", null)) ?? [];
  if (!assignments.length) return;
  unwrap(await supabase.from("weekly_lineup_snapshot").insert(assignments.map(item => ({ season_id: seasonId, schedule_week_id: weekId, franchise_id: item.franchise_id, player_id: item.player_id, roster_assignment_id: item.id, slot_code: item.assigned_slot_code }))));
}

/** Fetches every kicked-off game's box score for the week and returns raw stat lines
 * (not pre-computed points) keyed by normalized player name, plus "dst:<TEAM>" for
 * team defenses. Two real bugs fixed here, confirmed against an actual live Tank01 box
 * score response: (1) playerStats entries have no "pos" field at all -- the previous
 * code required a truthy position before storing anything, so every single player was
 * silently skipped, meaning this function had likely never actually contributed a
 * nonzero player score since it was written. Position is needed to call
 * calculateCvcFantasyPoints correctly (CVC's scoring rules are position-gated), so
 * that's deferred to the caller, which has the real position from CVC's own player
 * record. (2) box.teamStats is general team offense stats (totalYards,
 * rushingAttempts, etc.), keyed "away"/"home" with no real team code at the top level
 * -- the actual defensive-scoring data is the separate box.DST object, with the real
 * team code inside each entry's own teamAbv field. Same two bugs already fixed in the
 * client-side useCvcTank01LiveScores.ts; this is a separate, duplicate implementation
 * that was missed at the time. */
/** Server-side counterpart to the client's fetchEspnKickerEvents
 * (client/src/hooks/useCvcTank01LiveScores.ts) -- same approach, but calling ESPN's
 * API directly (the same URLs server/espnProxy.ts proxies for the client) instead of
 * a relative /api/espn/... path, which only resolves inside a browser. This exists
 * because the OFFICIAL scoring path (this file) was found, during the finalization
 * audit, to have no kicker-yardage override at all -- it took Tank01's raw
 * Kicking.fgYds directly, the same field the client-side comment confirms is
 * unreliable ("none of the players in a real, verified live box score had usable
 * Kicking.fgYds"). Live scoring already showed a kicker's correct point total during
 * the game; without this, the OFFICIAL score that actually determines standings and
 * win/loss records could still finalize that same made field goal as worth 0 yards --
 * a silent discrepancy between what was shown live and what actually counted. */
async function fetchEspnKickerEventsForWeek(games: { gameDate?: string; home?: string; away?: string }[]): Promise<KickerPlayEvent[]> {
  const events: KickerPlayEvent[] = [];
  const seen = new Set<string>();
  const dates = Array.from(new Set(games.map(game => game.gameDate).filter((date): date is string => Boolean(date))));
  for (const date of dates) {
    try {
      const scoreboard = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date}`);
      if (!scoreboard.ok) continue;
      const payload = await scoreboard.json() as { events?: Array<{ id?: string; competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }> }> }> };
      for (const game of games.filter(candidate => candidate.gameDate === date)) {
        const espnEvent = payload.events?.find(candidate => {
          const competitors = candidate.competitions?.[0]?.competitors ?? [];
          const home = competitors.find(item => item.homeAway === "home")?.team?.abbreviation;
          const away = competitors.find(item => item.homeAway === "away")?.team?.abbreviation;
          return normalizeTeam(home ?? "") === normalizeTeam(game.home ?? "") && normalizeTeam(away ?? "") === normalizeTeam(game.away ?? "");
        });
        if (!espnEvent?.id) continue;
        const summary = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${espnEvent.id}`);
        if (!summary.ok) continue;
        for (const play of parseEspnKickerEvents(await summary.json())) {
          const key = `${play.playerName}|${play.type}|${play.outcome}|${play.yards}|${play.text}`;
          if (!seen.has(key)) { seen.add(key); events.push(play); }
        }
      }
    } catch { /* one bad date's ESPN fetch shouldn't block the rest */ }
  }
  return events;
}

/** Overrides a player's Kicking.fgYds/xpMade with real per-kick ESPN data where
 * available, same guard logic as the client: only a player Tank01 already flagged
 * with FG attempt data is treated as a kicker (avoids misapplying FG/XP data to, say,
 * a returner whose Kicking field is actually kick-return yards), and only the
 * field(s) ESPN actually has events for get overridden -- if ESPN parsing finds
 * nothing for a kicker, their stat line is left as Tank01 provided it, not blanked
 * out. */
export function applyEspnKickerOverrides(statLines: Map<string, Tank01LiveStats>, kickerEvents: KickerPlayEvent[]) {
  if (!kickerEvents.length) return;
  for (const [key, entry] of Array.from(statLines)) {
    if (key.startsWith("dst:")) continue;
    const raw = entry as unknown as Record<string, unknown>;
    const longName = String(raw.longName ?? "");
    const existingKicking = raw.Kicking as Record<string, unknown> | undefined;
    if (!longName || !existingKicking || existingKicking.fgMade === undefined) continue;
    const playerEvents = getKickerEventsForPlayer(kickerEvents, longName);
    if (!playerEvents.length) continue;
    const fgYds = sumMadeFieldGoalYards(playerEvents);
    const xpMade = countMadeExtraPoints(playerEvents);
    const hasFgEvents = playerEvents.some(event => event.type === "fg");
    const hasXpEvents = playerEvents.some(event => event.type === "xp");
    statLines.set(key, { ...entry, Kicking: { ...existingKicking, ...(hasFgEvents ? { fgYds } : {}), ...(hasXpEvents ? { xpMade } : {}) } } as Tank01LiveStats);
  }
}

async function tankStatLinesForWeek(adapter: Tank01NFLDataAdapter, nflWeek: number, seasonYear: number) {
  const games = await adapter.listGamesForWeek(nflWeek, seasonYear);
  const kickedOffGames = games.filter(game => game.gameID && hasKickedOff(game.gameDate, game.gameTime));
  const statLines = new Map<string, Tank01LiveStats>();
  const gameStatuses = await mapWithConcurrencyLimit(kickedOffGames, 5, async game => {
    if (!game.gameID) return false;
    const box = await adapter.getBoxScore(game.gameID) as Tank01BoxScore;
    for (const raw of Object.values(box.playerStats ?? {})) {
      const player = raw as Record<string, unknown>;
      const name = String(player.longName ?? "");
      if (!name) continue;
      const nameKey = normalizePlayerName(name);
      statLines.set(nameKey, player as Tank01LiveStats);
      const rawTeam = player.team ?? player.teamAbv ?? player.team_abv ?? player.currentTeam;
      if (rawTeam) statLines.set(`${nameKey}|${normalizeTeam(String(rawTeam))}`, player as Tank01LiveStats);
    }
    const dst = (box as unknown as { DST?: Record<string, Record<string, unknown>> }).DST ?? {};
    for (const entry of Object.values(dst)) {
      const teamAbv = String(entry.teamAbv ?? "");
      if (teamAbv) statLines.set(`dst:${normalizeTeam(teamAbv)}`, { Defense: entry as unknown as Record<string, string | number> });
    }
    return isGameFinal(box as unknown as { gameStatus?: unknown; gameStatusCode?: unknown });
  });
  const kickerEvents = await fetchEspnKickerEventsForWeek(kickedOffGames);
  applyEspnKickerOverrides(statLines, kickerEvents);
  return { statLines, games, gameStatuses };
}

/** Idempotent provider-only score reconciliation. Called by the authenticated Heartbeat
 * callback for the normal live/upcoming week. Pass forceWeekNumber to instead target a
 * specific week regardless of its current status -- the only way to reach an
 * already-final week, since the normal lookup only ever considers live/upcoming
 * weeks. */
export async function syncTank01Scores(now = new Date(), forceWeekNumber?: number): Promise<Tank01SyncSummary> {
  const { season, week, weeks } = await currentContext(forceWeekNumber);
  if (!week) return { status: "skipped", matchupsUpdated: 0, reason: forceWeekNumber !== undefined ? `No CVC week numbered ${forceWeekNumber} was found.` : "No live or upcoming CVC week." };
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", matchupsUpdated: 0, reason: "Tank01 is not configured." };
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
  const matchups = unwrap(await supabase.from("matchup").select("id, home_franchise_id, away_franchise_id").eq("schedule_week_id", week.id)) ?? [];
  if (!matchups.length) return { status: "skipped", matchupsUpdated: 0, reason: "The CVC week has no matchups." };
  const franchiseIds = Array.from(new Set(matchups.flatMap(item => [item.home_franchise_id, item.away_franchise_id])));
  const alreadySnapshotted = unwrap(await supabase.from("weekly_lineup_snapshot").select("id").eq("schedule_week_id", week.id).limit(1)) ?? [];
  if (!alreadySnapshotted.length) await promotePlannedLineupForWeek(season.id, week.id, week.week_number, franchiseIds);
  await snapshotLineups(season.id, week.id, franchiseIds);
  const snapshots = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, slot_code, player:player_id(id, display_name, position, nfl_team)").eq("schedule_week_id", week.id)) as SnapshotRow[] ?? [];
  const { statLines, games, gameStatuses } = await tankStatLinesForWeek(adapter, week.week_number, season.year);
  if (!statLines.size) {
    unwrap(await supabase.from("tank01_scoring_sync_state").upsert({ season_id: season.id, last_attempt_at: now.toISOString(), last_error: null, updated_at: now.toISOString() }, { onConflict: "season_id" }).select("id").single());
    return { status: "skipped", weekLabel: week.label, matchupsUpdated: 0, reason: `Tank01 has not published box-score data for this CVC week. [debug: season.year=${season.year}, week.week_number=${week.week_number}, Tank01 games found=${games.length}, kicked-off games=${gameStatuses.length}]` };
  }
  const franchiseTotals = new Map<string, number>();
  for (const entry of snapshots) {
    // Confirmed live: weekly_lineup_snapshot includes bench players too (assigned_slot_code
    // is 'BENCH', not null, so snapshotLineups' not-null filter above never excluded them) --
    // this loop summed every snapshot row with no starter-only filter, meaning official,
    // persisted matchup scores could have been inflated by bench player performance, not
    // just a display-only bug. BENCH is CVC's only non-starter slot_code (confirmed via
    // roster_slot), so this exact exclusion is sufficient.
    if (entry.slot_code?.toUpperCase() === "BENCH") continue;
    const player = Array.isArray(entry.player) ? entry.player[0] : entry.player;
    if (!player) continue;
    const position = player.position === "DEF" ? "DST" : player.position ?? "";
    const statLine = resolveStatLine(statLines, player);
    const points = statLine ? calculateCvcFantasyPoints(statLine, position, rules) : 0;
    franchiseTotals.set(entry.franchise_id, (franchiseTotals.get(entry.franchise_id) ?? 0) + points);
  }
  const finalizing = shouldFinalizeWeek(games.length, gameStatuses);
  for (const matchup of matchups) {
    const homeScore = Math.round((franchiseTotals.get(matchup.home_franchise_id) ?? 0) * 100) / 100;
    const awayScore = Math.round((franchiseTotals.get(matchup.away_franchise_id) ?? 0) * 100) / 100;
    const resultState = finalizing ? "final" : "live";
    unwrap(await supabase.from("matchup").update({ home_score: homeScore, away_score: awayScore, result_state: resultState, updated_at: now.toISOString() }).eq("id", matchup.id).select("id").single());
  }
  unwrap(await supabase.from("schedule_week").update({ status: finalizing ? "final" : "live" }).eq("id", week.id).select("id").single());
  unwrap(await supabase.from("tank01_scoring_sync_state").upsert({ season_id: season.id, last_attempt_at: now.toISOString(), last_success_at: now.toISOString(), last_error: null, updated_at: now.toISOString() }, { onConflict: "season_id" }).select("id").single());
  if (finalizing) {
    const isLastWeek = week.week_number === Math.max(...weeks.map(item => item.week_number));
    await resolveSkinForWeek({ seasonId: season.id, weekNumber: week.week_number, isLastWeek, matchups, franchiseTotals, snapshots, statLines, rules, force: forceWeekNumber !== undefined });
    const ELIGIBLE_STAT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
    let fullPlayerPoolQuery = supabase.from("player").select("id, display_name, position, nfl_team").neq("provider", "placeholder").in("position", ELIGIBLE_STAT_POSITIONS);
    const mostRecentPlayerSync = unwrap(await supabase.from("player").select("last_seen_at").not("last_seen_at", "is", null).order("last_seen_at", { ascending: false }).limit(1).maybeSingle());
    if (mostRecentPlayerSync?.last_seen_at) fullPlayerPoolQuery = fullPlayerPoolQuery.gte("last_seen_at", mostRecentPlayerSync.last_seen_at);
    const activeFreeAgentPool = unwrap(await fullPlayerPoolQuery) ?? [];
    // Every currently-rostered player must always get a weekly row, regardless of the
    // active-player filter above -- someone owns them, so their season stats matter
    // unconditionally, unlike a long-retired free agent that filter is meant to skip
    // for efficiency. Confirmed as a real gap: the active-only pool alone left 56 of
    // 174 rostered players with no weekly row at all.
    const rosteredPlayers = snapshots.map(entry => Array.isArray(entry.player) ? entry.player[0] : entry.player).filter((player): player is WeeklyStatPlayer => Boolean(player));
    const seenPlayerIds = new Set(rosteredPlayers.map(player => player.id));
    const fullPlayerPool = [...rosteredPlayers, ...activeFreeAgentPool.filter(player => !seenPlayerIds.has(player.id))];
    const persistResult = await persistWeeklyStats({
      seasonId: season.id,
      scheduleWeekId: week.id,
      weekNumber: week.week_number,
      players: fullPlayerPool,
      statLines,
      rules,
    });
    await refreshSeasonStatsCurrent(season.id, persistResult.playerIdsWithActivity);
    unwrap(await supabase.from("audit_event").insert({ league_id: season.league_id, season_id: season.id, entity_type: "schedule_week", entity_id: week.id, action: "tank01_result_finalized", summary: `Tank01 finalized ${week.label} after the CVC correction window.`, payload: { source: "Tank01", matchups: matchups.length } }).select("id").single());
  }
  return { status: finalizing ? "finalized" : "updated", weekLabel: week.label, matchupsUpdated: matchups.length };
}
