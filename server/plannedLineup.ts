import { supabase, unwrap } from "./supabase";
import { resolveRosterPlayerForLineupEntry, type RosterPlayerRef } from "../shared/rosterPlayerResolution";

export type CurrentAssignment = { id: string; player_id: string; franchise_id: string; assigned_slot_code: string | null };
export type PlannedRow = { week_number: number; player_id: string; slot_code: string; display_name?: string | null; position?: string | null; nfl_team?: string | null };

/**
 * Pure cascading resolution: for a target future week, each player's effective slot
 * is whichever is the MOST RECENT explicit setting at or before that week -- either a
 * planned_lineup_assignment row for an earlier (but not later) week, or if none
 * exists, the player's actual current roster_assignment slot (the "week 1" baseline,
 * or wherever the owner last explicitly saved). This is the "carries over until
 * changed" behavior: a planned change at week 3 stays in effect for week 4, 5, ... until
 * overridden by a later explicit planned week, not just for week 3 alone.
 *
 * A newly-rostered player (added after the baseline was set) has no planned rows at
 * all, so naturally falls back to their current roster_assignment slot -- typically
 * BENCH until the owner places them, which is exactly the right default; no special
 * casing needed for "when were they acquired".
 */
export function resolveEffectiveLineupForWeek(targetWeekNumber: number, currentAssignments: CurrentAssignment[], plannedRows: PlannedRow[], rosterPlayers?: RosterPlayerRef[]): Map<string, string> {
  // When roster rows are supplied, a planned row saved under a stale or duplicate player id
  // is re-pointed at the roster row for the same person (see resolveRosterPlayerForLineupEntry).
  // Rows for people no longer on this franchise's roster resolve to null and are dropped.
  const remap = new Map<string, string | null>();
  const claimed = new Set<string>();
  const targetFor = (row: PlannedRow): string | null => {
    if (!rosterPlayers) return row.player_id;
    const key = `${row.player_id}|${row.display_name ?? ""}`;
    if (!remap.has(key)) {
      const hit = resolveRosterPlayerForLineupEntry(row, rosterPlayers, rosterPlayers.some(p => p.id === row.player_id) ? undefined : claimed);
      remap.set(key, hit?.id ?? null);
    }
    return remap.get(key) ?? null;
  };
  const latestPlannedByPlayer = new Map<string, { week_number: number; slot_code: string; exact: boolean }>();
  for (const row of plannedRows) {
    if (row.week_number > targetWeekNumber) continue;
    const target = targetFor(row);
    if (!target) continue;
    const exact = target === row.player_id;
    const existing = latestPlannedByPlayer.get(target);
    if (!existing || row.week_number > existing.week_number || (row.week_number === existing.week_number && exact && !existing.exact)) {
      latestPlannedByPlayer.set(target, { week_number: row.week_number, slot_code: row.slot_code, exact });
    }
  }
  const result = new Map<string, string>();
  for (const assignment of currentAssignments) {
    const planned = latestPlannedByPlayer.get(assignment.player_id);
    result.set(assignment.player_id, planned?.slot_code ?? assignment.assigned_slot_code ?? "BENCH");
  }
  return result;
}

const PLAYER_JOIN = "player:player_id(display_name, position, nfl_team)";
const one = (v: any) => (Array.isArray(v) ? v[0] : v);
const toRoster = (rows: any[]): RosterPlayerRef[] => rows.map(r => ({ id: r.player_id, display_name: one(r.player)?.display_name ?? "", position: one(r.player)?.position ?? null, nfl_team: one(r.player)?.nfl_team ?? null }));
const toPlanned = (rows: any[]): PlannedRow[] => rows
  .map((row: any) => ({ player_id: row.player_id, slot_code: row.slot_code, week_number: one(row.schedule_week)?.week_number, display_name: one(row.player)?.display_name ?? null, position: one(row.player)?.position ?? null, nfl_team: one(row.player)?.nfl_team ?? null }))
  .filter((row: any) => typeof row.week_number === "number") as PlannedRow[];

/** Loads the effective lineup for a franchise for a specific future week (not the
 * current live week -- callers use roster_assignment directly for that, and
 * weekly_lineup_snapshot for a past/final week). */
export async function loadEffectiveFutureLineup(seasonId: string, franchiseId: string, targetWeekNumber: number): Promise<Map<string, string>> {
  const [currentAssignments, plannedRows] = await Promise.all([
    supabase.from("roster_assignment").select(`id, player_id, franchise_id, assigned_slot_code, ${PLAYER_JOIN}`).eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null).then(result => unwrap(result) as any[]),
    supabase.from("planned_lineup_assignment").select(`player_id, slot_code, schedule_week:schedule_week_id(week_number), ${PLAYER_JOIN}`).eq("season_id", seasonId).eq("franchise_id", franchiseId)
      .then(result => (result.error ? [] : toPlanned(result.data ?? []))),
  ]);
  return resolveEffectiveLineupForWeek(targetWeekNumber, currentAssignments as CurrentAssignment[], plannedRows, toRoster(currentAssignments));
}

/** Applies every currently-rostered player's effective lineup for `week` into
 * roster_assignment.assigned_slot_code -- called once, right before a week's lineup
 * gets snapshotted for scoring, so "planning ahead" transparently becomes "the current
 * lineup" the moment that week goes live. A planned row whose player was since traded/
 * dropped is simply not among currentAssignments and is silently skipped -- no error. */
export async function promotePlannedLineupForWeek(seasonId: string, weekId: string, weekNumber: number, franchiseIds: string[]): Promise<{ franchisesUpdated: number; slotsPromoted: number }> {
  let slotsPromoted = 0;
  let franchisesUpdated = 0;
  for (const franchiseId of franchiseIds) {
    const currentAssignments = unwrap(await supabase.from("roster_assignment").select(`id, player_id, franchise_id, assigned_slot_code, ${PLAYER_JOIN}`).eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null)) as any[] ?? [];
    // Gracefully treats a failed query here (confirmed real cause: the
    // planned_lineup_assignment table's own migration was never actually run against
    // the real database) the same as "nothing was ever planned ahead" -- this feature
    // is purely additive on top of the current roster, so a missing/broken table
    // should never block the core weekly sync/recompute flow that calls this.
    const plannedResult = await supabase.from("planned_lineup_assignment").select(`player_id, slot_code, schedule_week:schedule_week_id(week_number), ${PLAYER_JOIN}`).eq("season_id", seasonId).eq("franchise_id", franchiseId);
    const plannedRows = plannedResult.error ? [] : toPlanned(plannedResult.data ?? []);
    if (!plannedRows.length) continue; // nothing was ever planned ahead -- current roster_assignment is already correct, no writes needed
    const effective = resolveEffectiveLineupForWeek(weekNumber, currentAssignments as CurrentAssignment[], plannedRows, toRoster(currentAssignments));
    let franchiseChanged = false;
    for (const assignment of currentAssignments) {
      const slot = effective.get(assignment.player_id);
      if (slot && slot !== assignment.assigned_slot_code) {
        unwrap(await supabase.from("roster_assignment").update({ assigned_slot_code: slot, updated_at: new Date().toISOString() }).eq("id", assignment.id).select("id").single());
        slotsPromoted += 1;
        franchiseChanged = true;
      }
    }
    if (franchiseChanged) franchisesUpdated += 1;
  }
  return { franchisesUpdated, slotsPromoted };
}
