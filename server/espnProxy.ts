import type { Request, Response } from "express";

const ESPN_TIMEOUT_MS = 8_000;

// Module-level response cache, shared across both ESPN proxy routes, keyed by full
// upstream URL. Same reasoning as tank01Proxy.ts's cache: a short TTL (just under the
// client's 30s poll interval) means multiple owners' tabs requesting the same live
// game at the same moment share one actual upstream call, protecting the account
// regardless of what any individual browser tab is running. Only successful responses
// are cached -- a transient upstream error must never get stuck and repeatedly served.
// Honest limitation: if the hosting platform runs multiple concurrent serverless
// instances, this in-memory cache isn't perfectly shared across all of them. It's not
// an absolute guarantee, just a real, meaningful reduction in call volume.
const CACHE_TTL_MS = 20_000;
const responseCache = new Map<string, { status: number; body: unknown; expiresAt: number }>();

export function __clearEspnProxyCacheForTests() { responseCache.clear(); }

async function fetchWithCache(url: string, res: Response): Promise<void> {
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    res.status(cached.status).json(cached.body);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESPN_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      res.status(response.status).json({ error: `ESPN request failed with status ${response.status}` });
      return;
    }
    const data = await response.json();
    responseCache.set(url, { status: response.status, body: data, expiresAt: Date.now() + CACHE_TTL_MS });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "ESPN request failed" });
  } finally {
    clearTimeout(timeout);
  }
}

/** Proxies ESPN's public scoreboard endpoint for a given date (YYYYMMDD), used to
 * derive live per-team game status (scheduled/in-progress/final, period, display
 * clock) for the "minutes remaining" display on Live Scoring. Ported directly from
 * WRC's own working proxyEspnScoreboard -- same endpoint, same validation, same
 * timeout. */
export async function proxyEspnScoreboard(req: Request, res: Response) {
  const dates = /^\d{8}$/.test(String(req.query.dates ?? "")) ? String(req.query.dates) : undefined;
  if (!dates) {
    res.status(400).json({ error: "Invalid or missing dates (expected YYYYMMDD)" });
    return;
  }
  await fetchWithCache(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dates}`, res);
}

/** Proxies ESPN's public game-summary endpoint (play-by-play), used to get exact
 * per-kick field-goal yardage for live kicker scoring -- Tank01's live box score
 * doesn't reliably include FG yardage at all. Same pattern as proxyEspnScoreboard. */
export async function proxyEspnSummary(req: Request, res: Response) {
  const eventId = /^\d+$/.test(String(req.query.event ?? "")) ? String(req.query.event) : undefined;
  if (!eventId) {
    res.status(400).json({ error: "Invalid or missing event (expected a numeric ESPN event ID)" });
    return;
  }
  await fetchWithCache(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`, res);
}
