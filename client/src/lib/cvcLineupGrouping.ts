export type CvcLineupPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null; status?: string | null };
export type CvcLineupAssignment = { id: string; assigned_slot_code: string | null; player: CvcLineupPlayer | null };
export type CvcLineupGroup = { key: "SFLEX" | "K" | "DST"; title: string; profile: "offense" | "kicker" | "defense"; starters: CvcLineupAssignment[]; bench: CvcLineupAssignment[] };

const BENCH_CODES = new Set(["", "BENCH", "BN", "IR", "TAXI"]);

export function isCvcBenchAssignment(assignment: Pick<CvcLineupAssignment, "assigned_slot_code">) {
  return BENCH_CODES.has((assignment.assigned_slot_code ?? "").trim().toUpperCase());
}

function orderLineupRows(rows: CvcLineupAssignment[]) {
  return [...rows].sort((a, b) => (a.assigned_slot_code ?? "BN").localeCompare(b.assigned_slot_code ?? "BN") || (a.player?.display_name ?? "").localeCompare(b.player?.display_name ?? ""));
}

export function groupCvcLineup(assignments: CvcLineupAssignment[]): CvcLineupGroup[] {
  const active = assignments.filter((assignment): assignment is CvcLineupAssignment & { player: CvcLineupPlayer } => Boolean(assignment.player));
  const build = (key: CvcLineupGroup["key"], title: string, profile: CvcLineupGroup["profile"], predicate: (player: CvcLineupPlayer) => boolean): CvcLineupGroup => {
    const rows = active.filter(assignment => predicate(assignment.player));
    return { key, title, profile, starters: orderLineupRows(rows.filter(row => !isCvcBenchAssignment(row))), bench: orderLineupRows(rows.filter(isCvcBenchAssignment)) };
  };
  return [
    build("SFLEX", "Superflex", "offense", player => !["K", "DST", "DEF"].includes((player.position ?? "").toUpperCase())),
    build("K", "Kicker", "kicker", player => (player.position ?? "").toUpperCase() === "K"),
    build("DST", "D/ST", "defense", player => ["DST", "DEF"].includes((player.position ?? "").toUpperCase())),
  ].filter(group => group.starters.length || group.bench.length);
}
