import type { Request, Response } from "express";

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const TANK01_TIMEOUT_MS = 15_000;
const ALLOWED_ENDPOINTS = new Set([
  "getNFLPlayerInfo",
  "getNFLTeams",
  "getNFLGamesForWeek",
  "getNFLBoxScore",
  "getNFLNews",
  "getNFLTeamSchedule",
  "getNFLGamesForPlayer",
  "getNFLProjections",
]);

// Module-level response cache, keyed by endpoint+params. Short TTL (just under the
// client's 30s poll interval) means multiple owners' tabs all requesting the same live
// game at the same moment share one actual upstream call instead of each tab hitting
// Tank01 independently -- this is the real chokepoint fix, since it protects the
// account regardless of what any individual browser tab is running (old JS, new JS, a
// tab left open for hours and never reloaded, none of that matters here). Only
// successful responses are cached -- a transient upstream error must never get stuck
// and repeatedly served for the TTL window.
// Honest limitation: if the hosting platform runs multiple concurrent serverless
// instances, this in-memory cache isn't perfectly shared across all of them. It's not
// an absolute guarantee, just a real, meaningful reduction in call volume.
const CACHE_TTL_MS = 20_000;
const responseCache = new Map<string, { status: number; contentType: string; body: string; expiresAt: number }>();

export function __clearTank01ProxyCacheForTests() { responseCache.clear(); }

/**
 * WRC-style server proxy for browser live-score reads. The browser may only
 * request allowlisted Tank01 endpoints and scalar inputs; the provider key is
 * never returned to the client.
 */
export async function proxyTank01Request(req: Request, res: Response): Promise<void> {
  const endpoint = req.params.endpoint;
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    res.status(404).json({ error: "Unknown Tank01 endpoint" });
    return;
  }

  const apiKey = process.env.TANK01_RAPIDAPI_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Tank01 live data is unavailable" });
    return;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string" && key.length <= 64 && value.length <= 256) query.set(key, value);
  }
  query.sort(); // stable cache key regardless of param insertion order
  const cacheKey = `${endpoint}?${query.toString()}`;

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.status(cached.status).type(cached.contentType).send(cached.body);
    return;
  }

  try {
    const upstream = await fetch(`https://${TANK01_HOST}/${endpoint}?${query.toString()}`, {
      headers: { "x-rapidapi-host": TANK01_HOST, "x-rapidapi-key": apiKey },
      signal: AbortSignal.timeout(TANK01_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    const body = await upstream.text();
    if (upstream.ok) responseCache.set(cacheKey, { status: upstream.status, contentType, body, expiresAt: Date.now() + CACHE_TTL_MS });
    res.status(upstream.status).type(contentType).send(body);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? "Tank01 request timed out" : "Tank01 is temporarily unavailable" });
  }
}
