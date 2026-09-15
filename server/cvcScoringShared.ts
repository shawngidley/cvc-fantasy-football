export const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

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
