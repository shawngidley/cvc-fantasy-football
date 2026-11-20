import { parse } from "csv-parse/sync";
import { supabase, unwrap } from "./supabase";
import { ELIGIBLE_POSITIONS, latestTeamsFromRosterRows, rosterKey, type RosterRow } from "./nflTeamAssignmentRules";

const NFLVERSE_ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv";
/** Supabase (PostgREST) caps any single select at 1000 rows unless you page. The
 * player table holds several thousand skill-position players, so a single select
 * silently synced only the first thousand for the whole season -- every player past
 * that point (Josh Downs, row ~2,960, among ~125 others) kept his August team no
 * matter how many times the cron ran. */
const PAGE_SIZE = 1000;

export type NflTeamAssignmentSyncResult = {
  rosterRowsFetched: number;
  matchedPlayers: number;
  updated: number;
  updatedPlayers: { displayName: string; from: string | null; to: string }[];
};

/** Every CVC skill-position player, paged so the whole table is read, not just the
 * first 1000 rows PostgREST returns by default. */
async function loadAllEligiblePlayers(): Promise<{ id: string; display_name: string; position: string | null; nfl_team: string | null }[]> {
  const players: { id: string; display_name: string; position: string | null; nfl_team: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").in("position", ELIGIBLE_POSITIONS).neq("provider", "placeholder").order("id").range(offset, offset + PAGE_SIZE - 1)) ?? [];
    players.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return players;
}

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
  const rows = parse(csvText, { columns: true, skip_empty_lines: true }) as RosterRow[];
  const latestByKey = latestTeamsFromRosterRows(rows);

  const players = await loadAllEligiblePlayers();

  let matchedPlayers = 0;
  const updatedPlayers: NflTeamAssignmentSyncResult["updatedPlayers"] = [];
  for (const player of players) {
    const match = latestByKey.get(rosterKey(player.display_name, player.position));
    if (!match || !match.team) continue; // not every CVC player is on a current NFL roster (retired, etc.) -- expected, not an error
    matchedPlayers++;
    if (match.team !== player.nfl_team) {
      unwrap(await supabase.from("player").update({ nfl_team: match.team }).eq("id", player.id).select("id").single());
      updatedPlayers.push({ displayName: player.display_name, from: player.nfl_team, to: match.team });
    }
  }

  return { rosterRowsFetched: rows.length, matchedPlayers, updated: updatedPlayers.length, updatedPlayers };
}
