export type LiveLineupPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null; metadata?: { tank01_id?: unknown } | null };
export type LiveLineupAssignment = { id: string; franchise_id: string; assigned_slot_code: string | null; player: LiveLineupPlayer | LiveLineupPlayer[] | null };

function playerFromRelation(value: LiveLineupAssignment["player"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Returns a franchise's full live-scoring roster -- starters AND bench alike. Named
 * "active" only in the sense of "not released" (already filtered by the caller's
 * .is("released_at", null)); it does NOT mean "starters only" despite the earlier
 * version of this function filtering out anything bench-coded. That filtering, combined
 * with the caller's own .not("assigned_slot_code", "is", null) query filter, meant
 * bench players (very commonly stored with assigned_slot_code = null, not the literal
 * string "BENCH") never reached the client at all -- confirmed as the reason the Live
 * Scoring page's bench section never rendered regardless of any client-side toggle.
 * The client already correctly splits starters from bench via isStarterSlot; it just
 * needs the full roster to split. */
export function franchiseLiveLineup(assignments: LiveLineupAssignment[], franchiseId: string) {
  return assignments
    .filter(item => item.franchise_id === franchiseId)
    .map(item => ({ id: item.id, slot: item.assigned_slot_code, player: playerFromRelation(item.player) }))
    .filter((item): item is { id: string; slot: string | null; player: LiveLineupPlayer } => Boolean(item.player));
}
