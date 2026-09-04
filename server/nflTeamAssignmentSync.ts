import { parse } from "csv-parse/sync";
import { supabase, unwrap } from "./supabase";
import { normalizeNFLTeamCode } from "../shared/nflTeamCodes";
import { normalizePlayerName } from "../shared/playerNameMatch";

const NFLVERSE_ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv";
const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];

export type NflTeamAssignmentSyncResult = {
  rosterRowsFetched: number;
  matchedPlayers: number;
  updated: number;
  updatedPlayers: { displayName: string; from: string | null; to: string }[];
};

/**
 * Syncs player.nfl_team directly from nflverse's roster_2026.csv, matched by
 * normalized name + position (not name alone -- CVC's player table can
 * legitimately contain two different real people who share a name, e.g.
 * multiple "Chris Smith"s at different positions, and keying on name alone
 * risks assigning one player's team to the wrong same-named player).
 *
 * Unlike WRC's model (a static draft-pool file + a separate live-overrides
 * table merged at read time), CVC's player table is the single source of
 * truth, so this updates nfl_team in place rather than writing to an
 * overrides table.
 */
export async function syncNflTeamAssignments(): Promise<NflTeamAssignmentSyncResult> {
  const response = await fetch(NFLVERSE_ROSTER_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`nflverse roster fetch failed with status ${response.status}`);
  const csvText = await response.text();
  const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  // nflverse's roster CSV has one row per player per week. Keep only the
  // highest week seen per (name, position) so a mid-season trade reflects the
  // player's most current team rather than their week-1 team.
  const latestByKey = new Map<string, { team: string; week: number }>();
  for (const row of rows) {
    const fullName = row.full_name?.trim();
    const position = (row.position ?? "").trim().toUpperCase();
    if (!fullName || !ELIGIBLE_POSITIONS.includes(position)) continue;
    const week = Number(row.week) || 0;
    const key = `${normalizePlayerName(fullName)}|${position}`;
    const existing = latestByKey.get(key);
    if (!existing || week > existing.week) {
      latestByKey.set(key, { team: normalizeNFLTeamCode(row.team), week });
    }
  }

  const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").in("position", ELIGIBLE_POSITIONS).neq("provider", "placeholder")) ?? [];

  let matchedPlayers = 0;
  const updatedPlayers: NflTeamAssignmentSyncResult["updatedPlayers"] = [];
  for (const player of players) {
    const key = `${normalizePlayerName(player.display_name)}|${(player.position ?? "").toUpperCase()}`;
    const match = latestByKey.get(key);
    if (!match || !match.team) continue; // not every CVC player is on a current NFL roster (retired, etc.) -- expected, not an error
    matchedPlayers++;
    if (match.team !== player.nfl_team) {
      unwrap(await supabase.from("player").update({ nfl_team: match.team }).eq("id", player.id).select("id").single());
      updatedPlayers.push({ displayName: player.display_name, from: player.nfl_team, to: match.team });
    }
  }

  return { rosterRowsFetched: rows.length, matchedPlayers, updated: updatedPlayers.length, updatedPlayers };
}
