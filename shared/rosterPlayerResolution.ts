import { normalizePlayerName } from "./playerNameMatch";

/** A saved lineup entry (planned row, snapshot row) described by the person it points at,
 * not just its database id. */
export type LineupEntryRef = { player_id: string; display_name?: string | null; position?: string | null; nfl_team?: string | null };
/** One player on ONE franchise's roster. Callers must pass a single franchise's roster only. */
export type RosterPlayerRef = { id: string; display_name: string; position?: string | null; nfl_team?: string | null };

const TEAM_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };
const normTeam = (v?: string | null) => (v ? (TEAM_ALIASES[v.toLowerCase()] ?? v.toLowerCase()) : "");
const normPos = (v?: string | null) => {
  const p = (v ?? "").toUpperCase();
  if (p === "DEF" || p === "DE" || p === "D/ST") return "DST";
  if (p === "KI" || p === "PK") return "K";
  return p;
};

/**
 * The one place that decides which roster player a saved lineup entry refers to.
 * Order: exact id, then normalized name (suffix and alias safe, position must agree when
 * both are known), then team defense (DST entry matches the roster DST for the same NFL
 * team, or the only DST on the roster when the entry has no team).
 * Only looks at the roster it is given, so it can never match another franchise.
 * Returns null when the person is no longer on the roster, so the entry is dropped.
 */
export function resolveRosterPlayerForLineupEntry(entry: LineupEntryRef, roster: RosterPlayerRef[], claimed?: Set<string>): RosterPlayerRef | null {
  const free = (p: RosterPlayerRef) => !claimed?.has(p.id);
  const byId = roster.find(p => p.id === entry.player_id);
  if (byId) return byId;
  const entryPos = normPos(entry.position);
  if (entry.display_name) {
    const key = normalizePlayerName(entry.display_name);
    if (key) {
      const hit = roster.find(p => free(p) && normalizePlayerName(p.display_name) === key && (!entryPos || !p.position || normPos(p.position) === entryPos));
      if (hit) return hit;
    }
  }
  if (entryPos === "DST") {
    const dsts = roster.filter(p => free(p) && normPos(p.position) === "DST");
    const team = normTeam(entry.nfl_team);
    if (team) return dsts.find(p => normTeam(p.nfl_team) === team) ?? null;
    return dsts.length === 1 ? dsts[0] : null;
  }
  return null;
}
