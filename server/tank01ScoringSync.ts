import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getNFLDataAdapter, Tank01NFLDataAdapter, type Tank01BoxScore } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";
import { resolveSkinForWeek } from "./cvcSkins";
import { normalize, normalizeTeam, type SnapshotRow } from "./cvcScoringShared";

export { normalize, normalizeTeam };
export const correctionWindowClosed = (now = new Date()) => now.getUTCDay() === 5 && now.getUTCHours() >= 16;

/**
 * Whether a CVC week should be finalized: it must be Friday 4pm UTC or later on the
 * calendar (correctionWindowClosed), AND every game actually scheduled for this
 * specific week must have already kicked off. correctionWindowClosed alone only knows
 * the calendar day/time -- it has no idea which week is being finalized. Confirmed as
 * a real bug: on the Friday WITHIN a week's own game window (Thursday night already
 * played, Sunday/Monday still ahead), correctionWindowClosed(now) alone is already
 * true, finalizing that week 3-4 days before its games are even done.
 */
export function shouldFinalizeWeek(games: { gameDate?: string; gameTime?: string }[], now = new Date()): boolean {
  if (!correctionWindowClosed(now)) return false;
  return games.length > 0 && games.every(game => hasKickedOff(game.gameDate, game.gameTime));
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




async function currentContext() {
  // Prefer the explicitly-flagged current season (see season.is_current migration) --
  // neither `year` nor `status` can safely identify it once a future season row exists
  // (e.g. to hold next year's tradeable rookie picks). Falls back to the old highest-
  // year behavior only if no season is flagged yet.
  const flagged = unwrap(await supabase.from("season").select("id, league_id, year").eq("is_current", true).limit(1).maybeSingle());
  const season = flagged ?? unwrap(await supabase.from("season").select("id, league_id, year").order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new Error("No CVC season is available for Tank01 scoring synchronization.");
  const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number, label, status").eq("season_id", season.id).order("week_number")) ?? [];
  const week = weeks.find(item => item.status === "live") ?? weeks.find(item => item.status === "upcoming") ?? null;
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
async function tankStatLinesForWeek(adapter: Tank01NFLDataAdapter, nflWeek: number, seasonYear: number) {
  const games = await adapter.listGamesForWeek(nflWeek, seasonYear);
  const kickedOffGames = games.filter(game => game.gameID && hasKickedOff(game.gameDate, game.gameTime));
  const statLines = new Map<string, Tank01LiveStats>();
  for (const game of kickedOffGames) {
    if (!game.gameID) continue;
    const box = await adapter.getBoxScore(game.gameID) as Tank01BoxScore;
    for (const raw of Object.values(box.playerStats ?? {})) {
      const player = raw as Record<string, unknown>;
      const name = String(player.longName ?? "");
      if (name) statLines.set(normalize(name), player as Tank01LiveStats);
    }
    const dst = (box as unknown as { DST?: Record<string, Record<string, unknown>> }).DST ?? {};
    for (const entry of Object.values(dst)) {
      const teamAbv = String(entry.teamAbv ?? "");
      if (teamAbv) statLines.set(`dst:${normalizeTeam(teamAbv)}`, { Defense: entry as unknown as Record<string, string | number> });
    }
  }
  return { statLines, games };
}

/** Idempotent provider-only score reconciliation. Called by the authenticated Heartbeat callback. */
export async function syncTank01Scores(now = new Date()): Promise<Tank01SyncSummary> {
  const { season, week, weeks } = await currentContext();
  if (!week) return { status: "skipped", matchupsUpdated: 0, reason: "No live or upcoming CVC week." };
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", matchupsUpdated: 0, reason: "Tank01 is not configured." };
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
  const matchups = unwrap(await supabase.from("matchup").select("id, home_franchise_id, away_franchise_id").eq("schedule_week_id", week.id)) ?? [];
  if (!matchups.length) return { status: "skipped", matchupsUpdated: 0, reason: "The CVC week has no matchups." };
  const franchiseIds = Array.from(new Set(matchups.flatMap(item => [item.home_franchise_id, item.away_franchise_id])));
  await snapshotLineups(season.id, week.id, franchiseIds);
  const snapshots = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, slot_code, player:player_id(id, display_name, position, nfl_team)").eq("schedule_week_id", week.id)) as SnapshotRow[] ?? [];
  const { statLines, games } = await tankStatLinesForWeek(adapter, week.week_number, season.year);
  if (!statLines.size) {
    unwrap(await supabase.from("tank01_scoring_sync_state").upsert({ season_id: season.id, last_attempt_at: now.toISOString(), last_error: null, updated_at: now.toISOString() }, { onConflict: "season_id" }).select("id").single());
    return { status: "skipped", weekLabel: week.label, matchupsUpdated: 0, reason: "Tank01 has not published box-score data for this CVC week." };
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
    const key = position === "DST" ? `dst:${normalizeTeam(player.nfl_team ?? "")}` : normalize(player.display_name);
    const statLine = statLines.get(key);
    const points = statLine ? calculateCvcFantasyPoints(statLine, position, rules) : 0;
    franchiseTotals.set(entry.franchise_id, (franchiseTotals.get(entry.franchise_id) ?? 0) + points);
  }
  const finalizing = shouldFinalizeWeek(games, now);
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
    await resolveSkinForWeek({ seasonId: season.id, weekNumber: week.week_number, isLastWeek, matchups, franchiseTotals, snapshots, statLines, rules });
    unwrap(await supabase.from("audit_event").insert({ league_id: season.league_id, season_id: season.id, entity_type: "schedule_week", entity_id: week.id, action: "tank01_result_finalized", summary: `Tank01 finalized ${week.label} after the CVC correction window.`, payload: { source: "Tank01", matchups: matchups.length } }).select("id").single());
  }
  return { status: finalizing ? "finalized" : "updated", weekLabel: week.label, matchupsUpdated: matchups.length };
}
