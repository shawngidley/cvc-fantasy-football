import { getNFLDataAdapter, Tank01NFLDataAdapter, type Tank01Game } from "./nflDataAdapter";
import { hasKickedOff } from "./tank01ScoringSync";
import { readSharedCache as readSharedTank01Cache, writeSharedCache as writeSharedTank01Cache } from "./tank01Proxy";

const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

// Per-load cache for this module's own lock checks ONLY (hasPlayerGameStarted /
// getLockedNflTeamsForWeek below) -- NOT used by tank01ScoringSync, dstSeasonAggregation,
// or syncPlanningWeekCutoffs, all of which call adapter.listGamesForWeek directly and
// must keep doing so: they run rarely (a cron, or a commissioner-triggered backfill) and
// need a fresh gameStatus to decide a game is actually final. This cache exists because
// every Free Agents / All Players / Watchlist page load was calling the uncached
// adapter.listGamesForWeek once per load, on top of whatever the Tank01 proxy itself
// already does for the browser-facing live-scoring calls.
//
// Caching this is safe specifically because both lock functions below decide "has this
// game started" from each game's static scheduled kickoff time (gameDate/gameTime)
// compared against the current clock, EVERY call -- a slightly stale list still locks at
// the correct instant. The only thing that ages under this TTL is gameStatus, and the
// lock doesn't use gameStatus at all today (see hasKickedOff, imported above) -- it's
// already the secondary, untrustworthy signal. IMPORTANT: if gameStatus is ever promoted
// to the primary signal for this lock, this 10-minute TTL becomes a correctness bug, not
// a cost saving -- revisit this cache at the same time.
const LOCK_CACHE_TTL_MS = 10 * 60_000;
// Distinct key prefix so this can never collide with the Tank01 proxy's own
// "${endpoint}?${query}" cache keys, even though both share the same Supabase table.
const lockCacheKey = (weekNumber: number, seasonYear: number) => `lock:getNFLGamesForWeek?week=${weekNumber}&season=${seasonYear}`;
const lockMemo = new Map<string, { games: Tank01Game[]; expiresAt: number }>();

export function __clearLockGamesCacheForTests() { lockMemo.clear(); }

/**
 * Cached wrapper around adapter.listGamesForWeek, used ONLY by this module's own lock
 * checks. See the LOCK_CACHE_TTL_MS comment above for why a 10-minute-stale list is
 * safe here specifically.
 *
 * GUARD -- load-bearing, do not remove: an empty list is NEVER cached, and an empty
 * list read back from the shared cache is NEVER accepted (treated as a miss instead).
 * Both lock functions below fail OPEN when they find no game for a team -- correct for
 * a real bye week, but if Tank01 ever returns a 200 with an empty body (a real,
 * observed upstream failure mode), caching that would publish "nothing has started" to
 * the shared table for the full 10 minutes, across every serverless instance, for
 * every owner at once -- holding the pickup window open past a real kickoff league-
 * wide. Uncached, that same blip is one wrong answer that the very next call fixes.
 * The kickoff-time math protects against a STALE list but not an EMPTY one, because an
 * empty list removes the input that math runs on.
 */
async function getCachedGamesForWeek(weekNumber: number, seasonYear: number): Promise<Tank01Game[]> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured; player game status can't be verified.");
  const cacheKey = lockCacheKey(weekNumber, seasonYear);

  const memoed = lockMemo.get(cacheKey);
  if (memoed && memoed.expiresAt > Date.now()) return memoed.games;

  // L2: shared across serverless instances. Best-effort -- readSharedCache already
  // swallows its own errors and returns null, so a cache problem here just means one
  // extra upstream fetch, never a thrown error.
  const shared = await readSharedTank01Cache(cacheKey, LOCK_CACHE_TTL_MS);
  if (shared) {
    try {
      const games = JSON.parse(shared.body) as Tank01Game[];
      if (games.length) { // empty-list guard: never accept an empty cached list
        lockMemo.set(cacheKey, { games, expiresAt: Date.now() + LOCK_CACHE_TTL_MS });
        return games;
      }
    } catch {
      // corrupt cache entry -- fall through to a real fetch below
    }
  }

  const games = await adapter.listGamesForWeek(weekNumber, seasonYear);
  if (games.length) { // empty-list guard: never cache an empty list
    lockMemo.set(cacheKey, { games, expiresAt: Date.now() + LOCK_CACHE_TTL_MS });
    await writeSharedTank01Cache(cacheKey, 200, "application/json", JSON.stringify(games));
  }
  return games;
}

/**
 * Whether a given NFL team's game has already started for a CVC week -- the shared
 * check behind both the (previously unenforced) lineup-slot lock and the new
 * free-agent-acquisition lock.
 *
 * A team on a bye, or with no scheduled game found for the week at all, is NOT locked
 * -- they're eligible the whole week, matching the confirmed rule (a bye player stays
 * pickupable/editable all week).
 *
 * Uses the same schedule-based kickoff check already proven correct for the live
 * scoring sync (hasKickedOff, built on Date.UTC() to avoid the 8pm+ local-kickoff
 * string-interpolation overflow bug) rather than a live per-game status field or box
 * score -- this is the already-cached weekly schedule fetch, not an extra per-player
 * API call, so checking many free agents at once (e.g. rendering the whole Free Agents
 * list) doesn't multiply API usage the way a per-player live-status check would.
 *
 * FAIL-SAFE: if the check itself can't be completed (the schedule fetch errors, the
 * adapter isn't configured, etc.), this throws rather than silently returning false --
 * callers must treat a thrown error as "locked" and block the action, never let an
 * acquisition or lineup change through when the game-started status genuinely can't be
 * verified.
 */
export async function hasPlayerGameStarted(nflTeam: string | null | undefined, weekNumber: number, seasonYear: number): Promise<boolean> {
  if (!nflTeam) return false;
  const games = await getCachedGamesForWeek(weekNumber, seasonYear);
  const team = normalizeTeam(nflTeam);
  const game = games.find(candidate => (candidate.away && normalizeTeam(candidate.away) === team) || (candidate.home && normalizeTeam(candidate.home) === team));
  if (!game) return false; // bye week / no game scheduled this week -- eligible all week
  return hasKickedOff(game.gameDate, game.gameTime);
}

/**
 * Same check, but fails safe (treats any error as "locked") rather than throwing --
 * for use at the exact acquisition/edit gate, where the correct behavior on an
 * unverifiable check is to block the action, not surface a raw error.
 */
export async function isPlayerLockedForGameStart(nflTeam: string | null | undefined, weekNumber: number, seasonYear: number): Promise<boolean> {
  try {
    return await hasPlayerGameStarted(nflTeam, weekNumber, seasonYear);
  } catch {
    return true;
  }
}

/**
 * Batch form of hasPlayerGameStarted, for rendering a whole list of free agents (up to
 * ~300 players, but only ever 32 distinct NFL teams) without multiplying Tank01 API
 * calls -- fetches the week's games exactly once, not once per player. Returns the set
 * of normalized team codes whose game has already kicked off; a team on a bye or with
 * no game found is simply absent from the set (not locked), matching
 * hasPlayerGameStarted's own rule.
 *
 * Fails safe in the opposite direction from isPlayerLockedForGameStart: this is for
 * *display* (dimming an already-started player's Bid button in a list the owner is
 * just browsing), not the submission gate itself, so a schedule-fetch error here
 * returns an empty set (nothing shown as locked) rather than locking the whole list --
 * the real enforcement still happens at submitFaabBid's own isPlayerLockedForGameStart
 * check regardless of what this displays.
 */
export async function getLockedNflTeamsForWeek(weekNumber: number, seasonYear: number): Promise<Set<string>> {
  try {
    const games = await getCachedGamesForWeek(weekNumber, seasonYear);
    const locked = new Set<string>();
    for (const game of games) {
      if (!hasKickedOff(game.gameDate, game.gameTime)) continue;
      if (game.away) locked.add(normalizeTeam(game.away));
      if (game.home) locked.add(normalizeTeam(game.home));
    }
    return locked;
  } catch {
    return new Set();
  }
}

/** Checks a single player's team against the batch result above. */
export function isTeamLocked(nflTeam: string | null | undefined, lockedTeams: Set<string>): boolean {
  return !!nflTeam && lockedTeams.has(normalizeTeam(nflTeam));
}
