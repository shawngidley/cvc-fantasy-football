import { normalizeNFLTeamCode } from "../shared/nflTeamCodes";
import { normalizePlayerName } from "../shared/playerNameMatch";

export const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];

/** nflverse roster statuses that mean "no longer on this team's roster". A row with
 * one of these is that player's last known team, not his current one, so it must not
 * be written over whatever CVC already has (usually FA). */
const STALE_ROSTER_STATUSES = new Set(["CUT", "RET"]);

export type RosterRow = { full_name?: string; position?: string; team?: string; week?: string; status?: string };
export type LatestTeamByKey = Map<string, { team: string; week: number }>;

export function rosterKey(name: string, position: string | null | undefined): string {
  return `${normalizePlayerName(name)}|${(position ?? "").trim().toUpperCase()}`;
}

/** Collapses nflverse's roster rows (one per player per week) to each player's most
 * recent team. Rows marked cut or retired are ignored entirely: they would otherwise
 * win on "latest week" and re-assign a free agent to the team that released him. */
export function latestTeamsFromRosterRows(rows: RosterRow[]): LatestTeamByKey {
  const latestByKey: LatestTeamByKey = new Map();
  for (const row of rows) {
    const fullName = row.full_name?.trim();
    const position = (row.position ?? "").trim().toUpperCase();
    if (!fullName || !ELIGIBLE_POSITIONS.includes(position)) continue;
    if (STALE_ROSTER_STATUSES.has((row.status ?? "").trim().toUpperCase())) continue;
    const week = Number(row.week) || 0;
    const key = rosterKey(fullName, position);
    const existing = latestByKey.get(key);
    if (!existing || week > existing.week) {
      latestByKey.set(key, { team: normalizeNFLTeamCode(row.team), week });
    }
  }
  return latestByKey;
}
