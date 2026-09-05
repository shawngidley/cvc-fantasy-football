import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getNFLDataAdapter, Tank01NFLDataAdapter, type Tank01BoxScore } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());
export const correctionWindowClosed = (now = new Date()) => now.getUTCDay() === 5 && now.getUTCHours() >= 16;

export type Tank01SyncSummary = {
  status: "skipped" | "updated" | "finalized";
  weekLabel?: string;
  matchupsUpdated: number;
  reason?: string;
};

type SnapshotRow = { franchise_id: string; slot_code: string; player: { display_name: string; position: string | null; nfl_team: string | null }[] | null };

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
  return { season, week };
}

async function snapshotLineups(seasonId: string, weekId: string, franchiseIds: string[]) {
  const existing = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, player_id").eq("schedule_week_id", weekId)) ?? [];
  if (existing.length) return;
  const assignments = unwrap(await supabase.from("roster_assignment").select("id, franchise_id, player_id, assigned_slot_code").eq("season_id", seasonId).in("franchise_id", franchiseIds).is("released_at", null).not("assigned_slot_code", "is", null)) ?? [];
  if (!assignments.length) return;
  unwrap(await supabase.from("weekly_lineup_snapshot").insert(assignments.map(item => ({ season_id: seasonId, schedule_week_id: weekId, franchise_id: item.franchise_id, player_id: item.player_id, roster_assignment_id: item.id, slot_code: item.assigned_slot_code }))));
}

async function tankScoresForWeek(adapter: Tank01NFLDataAdapter, nflWeek: number, seasonYear: number, rules: CvcScoringRule[]) {
  const games = await adapter.listGamesForWeek(nflWeek, seasonYear);
  const scoreMap = new Map<string, number>();
  for (const game of games) {
    if (!game.gameID) continue;
    const box = await adapter.getBoxScore(game.gameID) as Tank01BoxScore;
    for (const raw of Object.values(box.playerStats ?? {})) {
      const player = raw as Record<string, unknown>;
      const name = String(player.longName ?? "");
      const rawPosition = String(player.pos ?? "");
      const position = rawPosition.toUpperCase() === "PK" ? "K" : rawPosition;
      if (name && position) scoreMap.set(normalize(name), calculateCvcFantasyPoints(player as Tank01LiveStats, position, rules));
    }
    for (const [team, stats] of Object.entries(box.teamStats ?? {})) {
      scoreMap.set(`dst:${normalizeTeam(team)}`, calculateCvcFantasyPoints({ Defense: stats as unknown as Record<string, string | number> }, "DST", rules));
    }
  }
  return scoreMap;
}

/** Idempotent provider-only score reconciliation. Called by the authenticated Heartbeat callback. */
export async function syncTank01Scores(now = new Date()): Promise<Tank01SyncSummary> {
  const { season, week } = await currentContext();
  if (!week) return { status: "skipped", matchupsUpdated: 0, reason: "No live or upcoming CVC week." };
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", matchupsUpdated: 0, reason: "Tank01 is not configured." };
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
  const matchups = unwrap(await supabase.from("matchup").select("id, home_franchise_id, away_franchise_id").eq("schedule_week_id", week.id)) ?? [];
  if (!matchups.length) return { status: "skipped", matchupsUpdated: 0, reason: "The CVC week has no matchups." };
  const franchiseIds = Array.from(new Set(matchups.flatMap(item => [item.home_franchise_id, item.away_franchise_id])));
  await snapshotLineups(season.id, week.id, franchiseIds);
  const snapshots = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, slot_code, player:player_id(display_name, position, nfl_team)").eq("schedule_week_id", week.id)) as SnapshotRow[] ?? [];
  const tankScores = await tankScoresForWeek(adapter, week.week_number, season.year, rules);
  if (!tankScores.size) {
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
    const player = entry.player?.[0];
    if (!player) continue;
    const position = player.position === "DEF" ? "DST" : player.position ?? "";
    const key = position === "DST" ? `dst:${normalizeTeam(player.nfl_team ?? "")}` : normalize(player.display_name);
    franchiseTotals.set(entry.franchise_id, (franchiseTotals.get(entry.franchise_id) ?? 0) + (tankScores.get(key) ?? 0));
  }
  const finalizing = correctionWindowClosed(now);
  for (const matchup of matchups) {
    const homeScore = Math.round((franchiseTotals.get(matchup.home_franchise_id) ?? 0) * 100) / 100;
    const awayScore = Math.round((franchiseTotals.get(matchup.away_franchise_id) ?? 0) * 100) / 100;
    const resultState = finalizing ? "final" : "live";
    unwrap(await supabase.from("matchup").update({ home_score: homeScore, away_score: awayScore, result_state: resultState, updated_at: now.toISOString() }).eq("id", matchup.id).select("id").single());
  }
  unwrap(await supabase.from("schedule_week").update({ status: finalizing ? "final" : "live" }).eq("id", week.id).select("id").single());
  unwrap(await supabase.from("tank01_scoring_sync_state").upsert({ season_id: season.id, last_attempt_at: now.toISOString(), last_success_at: now.toISOString(), last_error: null, updated_at: now.toISOString() }, { onConflict: "season_id" }).select("id").single());
  if (finalizing) unwrap(await supabase.from("audit_event").insert({ league_id: season.league_id, season_id: season.id, entity_type: "schedule_week", entity_id: week.id, action: "tank01_result_finalized", summary: `Tank01 finalized ${week.label} after the CVC correction window.`, payload: { source: "Tank01", matchups: matchups.length } }).select("id").single());
  return { status: finalizing ? "finalized" : "updated", weekLabel: week.label, matchupsUpdated: matchups.length };
}
