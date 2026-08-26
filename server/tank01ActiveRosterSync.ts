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
  matchedByStoredId: number;
  matchedByNameNewlyLinked: number;
  matchedDst: number;
  errors: Record<string, string>;
  sampleRosterPlayer?: unknown;
};

/** WRC's proven technique, adapted for CVC: Tank01's getNFLTeamRoster returns each
 * team's actual CURRENT roster -- a retired player simply cannot appear in it, unlike
 * FantasyPros' /players endpoint (a broad all-time database) or its ROS rankings.
 *
 * Unlike the first version of this sync, matching is now permanent, not re-guessed
 * every run: any CVC player already carrying metadata.tank01_id (set by a previous run
 * of this sync, or backfilled) is matched by that exact ID -- a simple, 100% reliable
 * set-membership check, no name normalization involved at all. Only players without a
 * stored tank01_id yet fall back to name matching (with suffix stripping, e.g. "Patrick
 * Mahomes" vs "Patrick Mahomes II"), and when that succeeds, the confirmed ID is written
 * back so this player never needs name matching again on any future run. Over repeated
 * runs, the fraction relying on name matching should shrink toward zero. */
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
  const rosterIdsByName = new Map<string, string>(); // canonical(longName) -> tank01 playerID
  const rosterPlayerIds = new Set<string>();
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
          if (player.playerID) rosterPlayerIds.add(player.playerID);
          if (player.longName && player.playerID) rosterIdsByName.set(canonical(player.longName), player.playerID);
        }
      } catch (error) {
        errors[abv] = error instanceof Error ? error.message : "Request failed";
      }
    }));
  }

  const now = new Date().toISOString();
  const players = unwrap(await supabase.from("player").select("id, display_name, position, metadata").neq("provider", "placeholder").limit(5000)) as { id: string; display_name: string; position: string | null; metadata: Record<string, unknown> | null }[];

  const activeIds: string[] = [];
  const newlyLinked: { id: string; metadata: Record<string, unknown> }[] = [];
  let matchedByStoredId = 0;
  let matchedByNameNewlyLinked = 0;
  for (const player of players) {
    if (player.position === "DST") continue; // handled unconditionally below
    const storedTank01Id = player.metadata?.tank01_id ? String(player.metadata.tank01_id) : null;
    if (storedTank01Id) {
      if (rosterPlayerIds.has(storedTank01Id)) { activeIds.push(player.id); matchedByStoredId += 1; }
      continue;
    }
    const foundId = rosterIdsByName.get(canonical(player.display_name));
    if (foundId) {
      activeIds.push(player.id);
      newlyLinked.push({ id: player.id, metadata: { ...(player.metadata ?? {}), tank01_id: foundId } });
      matchedByNameNewlyLinked += 1;
    }
  }
  const dstIds = players.filter(player => player.position === "DST").map(player => player.id);

  for (const link of newlyLinked) {
    unwrap(await supabase.from("player").update({ metadata: link.metadata }).eq("id", link.id).select("id").single());
  }
  const allActiveIds = [...activeIds, ...dstIds];
  for (let i = 0; i < allActiveIds.length; i += 500) {
    unwrap(await supabase.from("player").update({ last_seen_at: now }).in("id", allActiveIds.slice(i, i + 500)).select("id"));
  }

  return { teamsProcessed: teamAbvs.length - Object.keys(errors).length, totalRosterPlayers, matchedByStoredId, matchedByNameNewlyLinked, matchedDst: dstIds.length, errors, sampleRosterPlayer };
}
