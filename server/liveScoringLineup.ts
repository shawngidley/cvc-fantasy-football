export type LiveLineupPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null };
export type LiveLineupAssignment = { id: string; franchise_id: string; assigned_slot_code: string | null; player: LiveLineupPlayer | LiveLineupPlayer[] | null };

const BENCH_SLOTS = new Set(["", "BN", "BENCH", "IR", "TAXI"]);

function playerFromRelation(value: LiveLineupAssignment["player"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function activeLiveLineup(assignments: LiveLineupAssignment[], franchiseId: string) {
  return assignments
    .filter(item => item.franchise_id === franchiseId && !BENCH_SLOTS.has((item.assigned_slot_code ?? "").trim().toUpperCase()))
    .map(item => ({ id: item.id, slot: item.assigned_slot_code, player: playerFromRelation(item.player) }))
    .filter((item): item is { id: string; slot: string | null; player: LiveLineupPlayer } => Boolean(item.player));
}
