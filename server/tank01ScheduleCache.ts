import type { Tank01NFLDataAdapter, Tank01Game } from "./nflDataAdapter";
import { isLiveGameWindow } from "./tank01LiveWindow";
import { readSharedCache, writeSharedCache } from "./tank01Proxy";

// Off-window cache for the scoring cron's weekly schedule read ONLY. The cron fires every
// 5 minutes around the clock and called adapter.listGamesForWeek uncached each time, so a
// quiet Tuesday still cost ~12 Tank01 calls an hour for a schedule that cannot change.
// This serves that one read from a 60 minute cache, but only while no game can plausibly
// be live (isLiveGameWindow false). In-window, and for any manual or forced sync, the
// caller does a real fetch.
//
// Trade-off, accepted on purpose: the schedule's gameStatus can be up to 60 minutes stale
// off-window, so finalizing a week after the last game can land up to an hour later.
// Box scores (the live gameStatusCode that actually decides "final") are NOT cached here.
const OFF_WINDOW_SCHEDULE_TTL_MS = 60 * 60_000;
// Distinct prefix: never collides with the proxy's "endpoint?query" keys or the lock's "lock:" keys.
const cronKey = (week: number, season: number) => `cron:getNFLGamesForWeek?week=${week}&season=${season}`;
const memo = new Map<string, { games: Tank01Game[]; expiresAt: number }>();

export function __clearCronScheduleCacheForTests() { memo.clear(); }

export async function listGamesForWeekForCron(adapter: Tank01NFLDataAdapter, week: number, season: number, now: Date = new Date()): Promise<Tank01Game[]> {
  // In-window: always fresh. A game may be live, and gameStatus matters.
  if (isLiveGameWindow(now)) return adapter.listGamesForWeek(week, season);

  const key = cronKey(week, season);
  const nowMs = now.getTime();
  const memoed = memo.get(key);
  if (memoed && memoed.expiresAt > nowMs) return memoed.games;

  const shared = await readSharedCache(key, OFF_WINDOW_SCHEDULE_TTL_MS);
  if (shared) {
    try {
      const games = JSON.parse(shared.body) as Tank01Game[];
      if (games.length) { // never accept an empty cached list
        memo.set(key, { games, expiresAt: nowMs + OFF_WINDOW_SCHEDULE_TTL_MS });
        return games;
      }
    } catch {
      // corrupt entry, fall through to a real fetch
    }
  }

  const games = await adapter.listGamesForWeek(week, season);
  if (games.length) { // never cache an empty list (a 200 with an empty body is a real upstream failure mode)
    memo.set(key, { games, expiresAt: nowMs + OFF_WINDOW_SCHEDULE_TTL_MS });
    await writeSharedCache(key, 200, "application/json", JSON.stringify(games));
  }
  return games;
}
