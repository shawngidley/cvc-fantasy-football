import { normalizePlayerName } from "@shared/playerNameMatch";

export const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

/** Two different real players can share the exact same name (confirmed real case: two
 * distinct NFL players, different birth years and college careers, both named
 * "Antonio Williams" -- one a 2026 rookie WR, one a since-retired RB). A statLines map
 * keyed purely by normalized name has no way to tell them apart -- whichever one a
 * box score happens to process second silently overwrites the first, and any CVC
 * player record resolving to that same name-only key then gets whichever one won,
 * right or wrong. Builds the lookup key a player's own team can disambiguate with,
 * falling back to name-only when team info isn't available on one side or the other
 * (kept as a real fallback, not just theoretical -- a name-only key is still correct
 * for the overwhelming majority of players, who don't share their name with anyone
 * else in the league). */
export function resolveStatLine<T>(statLines: Map<string, T>, player: { display_name: string; nfl_team?: string | null; position?: string | null }): T | undefined {
  const position = player.position === "DEF" ? "DST" : player.position ?? "";
  if (position === "DST") return statLines.get(`dst:${normalizeTeam(player.nfl_team ?? "")}`);
  const nameKey = normalizePlayerName(player.display_name);
  if (player.nfl_team) {
    const teamKey = `${nameKey}|${normalizeTeam(player.nfl_team)}`;
    if (statLines.has(teamKey)) return statLines.get(teamKey);
  }
  return statLines.get(nameKey);
}

export type SnapshotPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null };
export type SnapshotRow = { franchise_id: string; slot_code: string; player: SnapshotPlayer[] | SnapshotPlayer | null };

/** Runs fn against every item in `items`, at most `limit` in flight at once, and
 * returns results in the same order as the input. Confirmed as a real, previously-
 * ungated risk: a full week's worth of box score fetches (up to ~14-16 games) run
 * fully sequentially (one `await` at a time) can approach or exceed a serverless
 * function's execution time limit, which fails silently -- the function gets killed
 * mid-execution before it can log or return a useful error. This doesn't fully
 * parallelize (which risks the exact opposite problem -- a burst of simultaneous
 * requests Tank01 may throttle, the same failure mode already confirmed and fixed for
 * player-profile fetching in useCvcTank01PlayerProfiles.ts), it bounds concurrency
 * instead. */
export async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
