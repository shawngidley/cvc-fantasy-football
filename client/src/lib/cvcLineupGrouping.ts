export type CvcLineupPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null; status?: string | null; metadata?: Record<string, unknown> | null };
export type CvcLineupAssignment = { id: string; assigned_slot_code: string | null; player: CvcLineupPlayer | null };
export type CvcLineupGroup = { key: "OFFENSE" | "K" | "DST"; title: string; profile: "offense" | "kicker" | "defense"; starters: CvcLineupAssignment[]; bench: CvcLineupAssignment[] };

const BENCH_CODES = new Set(["", "BENCH", "BN", "IR", "TAXI"]);

export function isCvcBenchAssignment(assignment: Pick<CvcLineupAssignment, "assigned_slot_code">) {
  return BENCH_CODES.has((assignment.assigned_slot_code ?? "").trim().toUpperCase());
}

function orderLineupRows(rows: CvcLineupAssignment[]) {
  const starterOrder: Record<string, number> = { QB: 0, RB1: 1, RB2: 2, WR1: 3, WR2: 4, TE: 5, FLEX: 6, K: 7, DST: 8 };
  const benchOrder: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DST: 5, DEF: 5 };
  return [...rows].sort((a, b) => {
    const aBench = isCvcBenchAssignment(a); const bBench = isCvcBenchAssignment(b);
    const aPosition = normalizeCvcPosition(a.player?.position); const bPosition = normalizeCvcPosition(b.player?.position);
    const aOrder = aBench ? (benchOrder[aPosition] ?? 99) : (starterOrder[(a.assigned_slot_code ?? "").trim().toUpperCase()] ?? 99);
    const bOrder = bBench ? (benchOrder[bPosition] ?? 99) : (starterOrder[(b.assigned_slot_code ?? "").trim().toUpperCase()] ?? 99);
    return aOrder - bOrder || aPosition.localeCompare(bPosition) || (a.player?.display_name ?? "").localeCompare(b.player?.display_name ?? "");
  });
}

export function normalizeCvcPosition(position: string | null | undefined) {
  const normalized = (position ?? "").trim().toUpperCase();
  if (normalized === "KI") return "K";
  if (normalized === "DE") return "DST";
  return normalized;
}

export function groupCvcLineup(assignments: CvcLineupAssignment[]): CvcLineupGroup[] {
  const active = assignments.filter((assignment): assignment is CvcLineupAssignment & { player: CvcLineupPlayer } => Boolean(assignment.player));
  const build = (key: CvcLineupGroup["key"], title: string, profile: CvcLineupGroup["profile"], predicate: (player: CvcLineupPlayer) => boolean): CvcLineupGroup => {
    const rows = active.filter(assignment => predicate(assignment.player));
    return { key, title, profile, starters: orderLineupRows(rows.filter(row => !isCvcBenchAssignment(row))), bench: orderLineupRows(rows.filter(isCvcBenchAssignment)) };
  };
  return [
    build("OFFENSE", "Offense", "offense", player => !["K", "DST", "DEF"].includes(normalizeCvcPosition(player.position))),
    build("K", "Kicker", "kicker", player => normalizeCvcPosition(player.position) === "K"),
    build("DST", "D/ST", "defense", player => ["DST", "DEF"].includes(normalizeCvcPosition(player.position))),
  ].filter(group => group.starters.length || group.bench.length);
}
