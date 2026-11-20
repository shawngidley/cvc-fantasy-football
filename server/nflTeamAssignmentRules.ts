import { normalizeNFLTeamCode } from "../shared/nflTeamCodes";
import { normalizePlayerName } from "../shared/playerNameMatch";

export const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];

/** CVC's team code for a player who isn't on any NFL roster. */
export const FREE_AGENT_TEAM = "FA";

/** nflverse roster statuses that mean "no longer on this team's roster": the row
 * names the team that cut the player, or the one he retired from, not a team he
 * plays for. Such a player is a free agent as far as CVC is concerned. Every other
 * status (ACT, RES, DEV, INA, EXE, the TR* trade markers) keeps him on that team. */
const RELEASED_STATUSES = new Set(["CUT", "RET"]);

export type RosterRow = { full_name?: string; position?: string; team?: string; week?: string; status?: string };
export type LatestTeamByKey = Map<string, { team: string; week: number }>;

export function rosterKey(name: string, position: string | null | undefined): string {
  return `${normalizePlayerName(name)}|${(position ?? "").trim().toUpperCase()}`;
}

/** Reduces nflverse's roster rows to each player's current team. In practice the
 * file carries one row per player, already reflecting his latest roster state (the
 * week column is the week that state was recorded); the highest-week rule below is
 * only a guard in case that ever changes. A row whose status says the player was
 * cut or retired resolves to FA, so the sync clears him off the team that released
 * him instead of leaving him listed there. */
export function latestTeamsFromRosterRows(rows: RosterRow[]): LatestTeamByKey {
  const latestByKey: LatestTeamByKey = new Map();
  for (const row of rows) {
    const fullName = row.full_name?.trim();
    const position = (row.position ?? "").trim().toUpperCase();
    if (!fullName || !ELIGIBLE_POSITIONS.includes(position)) continue;
    const released = RELEASED_STATUSES.has((row.status ?? "").trim().toUpperCase());
    const week = Number(row.week) || 0;
    const key = rosterKey(fullName, position);
    const existing = latestByKey.get(key);
    if (!existing || week > existing.week) {
      latestByKey.set(key, { team: released ? FREE_AGENT_TEAM : normalizeNFLTeamCode(row.team), week });
    }
  }
  return latestByKey;
}
