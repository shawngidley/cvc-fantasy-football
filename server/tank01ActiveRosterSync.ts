import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

// Strips common trailing name suffixes (Jr/Sr/II/III/IV) before the full alphanumeric
// strip below -- confirmed via a live Tank01 sample that longName is correctly
// populated (e.g. "Chad Ryland"), so the low 12.5% match rate on the first live run is
// much more likely explained by systematic suffix mismatches between sources (e.g.
// Tank01's "Patrick Mahomes" vs CVC's "Patrick Mahomes II") than a wrong field.
const SUFFIX_PATTERN = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;
const canonical = (value: string | null | undefined) => (value ?? "").trim().replace(SUFFIX_PATTERN, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Standard 32 NFL team abbreviations, used only as a fallback if Tank01's own team list
// can't be parsed -- the sync prefers fetching the live list first (below) so it isn't
// guessing at ambiguous abbreviations like JAX/JAC or WAS/WSH the way earlier attempts
// guessed at FantasyPros API parameters and got it wrong.
const FALLBACK_TEAM_ABVS = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS"];

export type Tank01ActiveRosterSyncSummary = {
  teamsProcessed: number;
  totalRosterPlayers: number;
  matchedPlayers: number;
  matchedDst: number;
  errors: Record<string, string>;
  sampleRosterPlayer?: unknown;
};

/** WRC's proven technique, adapted for CVC: Tank01's getNFLTeamRoster returns each
 * team's actual CURRENT roster -- a retired player simply cannot appear in it, unlike
 * FantasyPros' /players endpoint (a broad all-time database) or its ROS rankings (only
 * a 31% match rate in testing). Loops all 32 teams, unions every rostered player name,
 * and stamps last_seen_at for every CVC player matched -- plus unconditionally for
 * every DST entry, since all 32 NFL teams are always valid defense options.
 *
 * A live run only matched 336 of 2682 rostered players (12.5%) -- too low to be just
 * suffix/punctuation formatting gaps, and Tank01RosterPlayer.longName is marked
 * optional in its own type definition (never confirmed against a live response). Rather
 * than guess at a different field name, this now captures one raw roster player object
 * so the actual field names can be inspected directly. */
export async function syncTank01ActiveRoster(): Promise<Tank01ActiveRosterSyncSummary> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured for CVC.");

  let teamAbvs: string[] = FALLBACK_TEAM_ABVS;
  try {
    const teamsResult = await adapter.listTeams();
    const parsed = (teamsResult.body ?? [])
      .map((team: any) => team?.teamAbv ?? team?.abbreviation ?? team?.team_abv ?? team?.abv)
      .filter((abv: unknown): abv is string => typeof abv === "string" && abv.length > 0);
    if (parsed.length >= 28) teamAbvs = parsed; // sanity check: expect ~32, not a malformed/partial response
  } catch {
    // Falls through to FALLBACK_TEAM_ABVS below.
  }

  const errors: Record<string, string> = {};
  const rosterNames = new Set<string>();
  let totalRosterPlayers = 0;
  let sampleRosterPlayer: unknown;
  const CONCURRENCY = 5;
  for (let i = 0; i < teamAbvs.length; i += CONCURRENCY) {
    const chunk = teamAbvs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async abv => {
      try {
        const roster = await adapter.listTeamRoster(abv);
        totalRosterPlayers += roster.length;
        if (!sampleRosterPlayer && roster.length) sampleRosterPlayer = roster[0];
        for (const player of roster) {
          const name = player.longName;
          if (name) rosterNames.add(canonical(name));
        }
      } catch (error) {
        errors[abv] = error instanceof Error ? error.message : "Request failed";
      }
    }));
  }

  const now = new Date().toISOString();
  const players = unwrap(await supabase.from("player").select("id, display_name, position").neq("provider", "placeholder").limit(5000)) as { id: string; display_name: string; position: string | null }[];
  const matchedIds = players.filter(player => player.position !== "DST" && rosterNames.has(canonical(player.display_name))).map(player => player.id);
  const dstIds = players.filter(player => player.position === "DST").map(player => player.id);
  const allIds = [...matchedIds, ...dstIds];
  for (let i = 0; i < allIds.length; i += 500) {
    unwrap(await supabase.from("player").update({ last_seen_at: now }).in("id", allIds.slice(i, i + 500)).select("id"));
  }

  return { teamsProcessed: teamAbvs.length - Object.keys(errors).length, totalRosterPlayers, matchedPlayers: matchedIds.length, matchedDst: dstIds.length, errors, sampleRosterPlayer };
}
