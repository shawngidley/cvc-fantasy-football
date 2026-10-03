import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { hasKickedOff } from "./tank01ScoringSync";

const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

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
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured; player game status can't be verified.");
  const games = await adapter.listGamesForWeek(weekNumber, seasonYear);
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
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return new Set();
  try {
    const games = await adapter.listGamesForWeek(weekNumber, seasonYear);
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
