import { supabase, unwrap } from "./supabase";

export type CurrentAssignment = { id: string; player_id: string; franchise_id: string; assigned_slot_code: string | null };
export type PlannedRow = { week_number: number; player_id: string; slot_code: string };

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
export function resolveEffectiveLineupForWeek(targetWeekNumber: number, currentAssignments: CurrentAssignment[], plannedRows: PlannedRow[]): Map<string, string> {
  const latestPlannedByPlayer = new Map<string, { week_number: number; slot_code: string }>();
  for (const row of plannedRows) {
    if (row.week_number > targetWeekNumber) continue;
    const existing = latestPlannedByPlayer.get(row.player_id);
    if (!existing || row.week_number > existing.week_number) latestPlannedByPlayer.set(row.player_id, { week_number: row.week_number, slot_code: row.slot_code });
  }
  const result = new Map<string, string>();
  for (const assignment of currentAssignments) {
    const planned = latestPlannedByPlayer.get(assignment.player_id);
    result.set(assignment.player_id, planned?.slot_code ?? assignment.assigned_slot_code ?? "BENCH");
  }
  return result;
}

/** Loads the effective lineup for a franchise for a specific future week (not the
 * current live week -- callers use roster_assignment directly for that, and
 * weekly_lineup_snapshot for a past/final week). */
export async function loadEffectiveFutureLineup(seasonId: string, franchiseId: string, targetWeekNumber: number): Promise<Map<string, string>> {
  const [currentAssignments, plannedRows] = await Promise.all([
    supabase.from("roster_assignment").select("id, player_id, franchise_id, assigned_slot_code").eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null).then(result => unwrap(result) as CurrentAssignment[]),
    supabase.from("planned_lineup_assignment").select("player_id, slot_code, schedule_week:schedule_week_id(week_number)").eq("season_id", seasonId).eq("franchise_id", franchiseId)
      .then(result => (unwrap(result) ?? []).map((row: any) => ({ player_id: row.player_id, slot_code: row.slot_code, week_number: (Array.isArray(row.schedule_week) ? row.schedule_week[0] : row.schedule_week)?.week_number })).filter((row: any) => typeof row.week_number === "number") as PlannedRow[]),
  ]);
  return resolveEffectiveLineupForWeek(targetWeekNumber, currentAssignments, plannedRows);
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
    const currentAssignments = unwrap(await supabase.from("roster_assignment").select("id, player_id, franchise_id, assigned_slot_code").eq("season_id", seasonId).eq("franchise_id", franchiseId).is("released_at", null)) as CurrentAssignment[] ?? [];
    const plannedRowsRaw = unwrap(await supabase.from("planned_lineup_assignment").select("player_id, slot_code, schedule_week:schedule_week_id(week_number)").eq("season_id", seasonId).eq("franchise_id", franchiseId)) ?? [];
    const plannedRows = plannedRowsRaw.map((row: any) => ({ player_id: row.player_id, slot_code: row.slot_code, week_number: (Array.isArray(row.schedule_week) ? row.schedule_week[0] : row.schedule_week)?.week_number })).filter((row: any) => typeof row.week_number === "number") as PlannedRow[];
    if (!plannedRows.length) continue; // nothing was ever planned ahead -- current roster_assignment is already correct, no writes needed
    const effective = resolveEffectiveLineupForWeek(weekNumber, currentAssignments, plannedRows);
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
