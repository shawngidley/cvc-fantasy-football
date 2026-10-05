import type { Request, Response } from "express";
import { supabase } from "./supabase";
import { isLiveGameWindow } from "./tank01LiveWindow";

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

// Module-level response cache, keyed by endpoint+params. Per-endpoint TTLs below mean
// multiple owners' tabs all requesting the same live game at the same moment share one
// actual upstream call instead of each tab hitting Tank01 independently -- this is the
// real chokepoint fix, since it protects the account regardless of what any individual
// browser tab is running (old JS, new JS, a tab left open for hours and never reloaded,
// none of that matters here). Only successful responses are cached -- a transient
// upstream error must never get stuck and repeatedly served for the TTL window.
// Honest limitation: if the hosting platform runs multiple concurrent serverless
// instances, this in-memory cache isn't perfectly shared across all of them. It's not
// an absolute guarantee, just a real, meaningful reduction in call volume.
const DEFAULT_CACHE_TTL_MS = 20_000;

// The two "live" endpoints -- an in-game-caliber box score, and the week's schedule
// (used to tell which games are even worth polling) -- get a short TTL just under the
// client's 60s poll interval, but ONLY while an NFL game could plausibly be in progress
// (see tank01LiveWindow.ts). Outside that window -- roughly half of a typical week
// (85 of 168 hours are in-window: ~9am-2am Thu/Fri/Sat/Sun/Mon, so the off-window time
// is Tue/Wed plus the nightly 2am-9am gap) -- both fall back to a much longer TTL
// instead: nothing about either response changes meaningfully between a game ending
// Monday night and the next game kicking off Thursday, so there's no reason to keep
// paying for 50s/5min freshness around the clock.
const LIVE_ENDPOINT_IN_WINDOW_TTL_MS: Record<string, number> = {
  getNFLBoxScore: 50_000, // just under the 60s client poll interval
  getNFLGamesForWeek: 5 * 60_000, // matchups/kickoff times are static during games
};
// Off-window, per endpoint. The week's schedule gets a full hour rather than 15 minutes:
// once no game can be in progress, kickoff times for the week are simply set, so
// re-pulling the schedule every 15 minutes on every page load buys nothing.
const LIVE_ENDPOINT_OFF_WINDOW_TTL_MS: Record<string, number> = {
  getNFLBoxScore: 15 * 60_000,
  getNFLGamesForWeek: 60 * 60_000,
};

// A finished game's box score is immutable, so once its calendar day (ET) is in the
// past it can be cached far longer than any live window. This is the big quiet-day
// saver: opening Live Scoring re-pulls every fetch-eligible game from roughly the last
// 10 days to populate finals (useCvcTank01LiveScores.ts's fetchEligibleGames), and
// without this each of those already-final games fell back to the 15-minute off-window
// TTL -- so every page open, for every owner, re-fetched last week's finished games
// upstream. Now the first load of the day warms them and the rest of the day is served
// from cache. Official weekly scoring reads Tank01 through nflDataAdapter, bypassing
// this proxy cache entirely, so a rare next-day stat correction is never blocked by it.
const FINAL_GAME_TTL_MS = 12 * 60 * 60_000;

// Everything else: a flat per-endpoint TTL, no time-of-week awareness needed because
// these don't carry live in-game data at all.
const STATIC_ENDPOINT_TTL_MS: Record<string, number> = {
  getNFLNews: 15 * 60_000,
  getNFLPlayerInfo: 15 * 60_000,
  getNFLGamesForPlayer: 15 * 60_000,
  getNFLProjections: 60 * 60_000,
  getNFLTeamSchedule: 6 * 60 * 60_000,
  getNFLTeams: 6 * 60 * 60_000,
  // Not currently in ALLOWED_ENDPOINTS (nothing in CVC calls these yet), but configured
  // here so the TTL is already correct the moment either is wired up.
  getNFLADP: 6 * 60 * 60_000,
  getNFLDepthCharts: 6 * 60 * 60_000,
};

/** Today's date as YYYYMMDD in America/New_York, to compare against the date prefix of
 * a box score's gameID (e.g. "20261004_DAL@HOU"). Intl-based for the same reason
 * isLiveGameWindow is: a hardcoded UTC offset breaks across the DST boundary. */
function etDateYyyymmdd(now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const year = parts.find(part => part.type === "year")?.value ?? "";
  const month = parts.find(part => part.type === "month")?.value ?? "";
  const day = parts.find(part => part.type === "day")?.value ?? "";
  return `${year}${month}${day}`;
}

/** True for a getNFLBoxScore whose game falls on a past calendar day in ET -- a final
 * game whose stats can't change any more. Today's games (still live, or just finished)
 * keep the normal live/off-window TTL, since a game that ended an hour ago can still
 * pick up a stat correction. An unparseable or missing gameID returns false, so an
 * unexpected request shape degrades to the normal TTL rather than caching for 12h. */
function isPastDayBoxScore(endpoint: string, query: URLSearchParams, now: number): boolean {
  if (endpoint !== "getNFLBoxScore") return false;
  const datePart = (query.get("gameID") ?? "").slice(0, 8);
  if (!/^\d{8}$/.test(datePart)) return false;
  return datePart < etDateYyyymmdd(now); // zero-padded YYYYMMDD compares correctly as a string
}

/** Picks the cache TTL for one request at one moment -- the only place that decides
 * "how fresh does this need to be". Exported for the proxy's own tests. */
export function resolveCacheTtlMs(endpoint: string, query: URLSearchParams = new URLSearchParams(), now: number = Date.now()): number {
  if (isPastDayBoxScore(endpoint, query, now)) return FINAL_GAME_TTL_MS;
  if (endpoint in LIVE_ENDPOINT_IN_WINDOW_TTL_MS) {
    return isLiveGameWindow(now) ? LIVE_ENDPOINT_IN_WINDOW_TTL_MS[endpoint] : LIVE_ENDPOINT_OFF_WINDOW_TTL_MS[endpoint];
  }
  return STATIC_ENDPOINT_TTL_MS[endpoint] ?? DEFAULT_CACHE_TTL_MS;
}

const responseCache = new Map<string, { status: number; contentType: string; body: string; expiresAt: number }>();

// Shared L2 cache in Supabase, so the cache window actually holds across serverless
// instances and viewers -- the in-memory Map above is per-instance, and on Vercel each
// request can hit a different, short-lived instance, so it does NOT collapse many
// owners' overlapping polls the way a single shared cache does. Every read/write is
// best-effort: any error (including the table not existing yet) falls through to a
// normal upstream fetch, so a cache problem can never break live scoring. Run
// supabase/migrations/202609210001_cvc_tank01_response_cache.sql to create the table.
const SHARED_CACHE_TABLE = "tank01_response_cache";

async function readSharedCache(cacheKey: string, ttlMs: number): Promise<{ status: number; contentType: string; body: string } | null> {
  try {
    const { data, error } = await supabase
      .from(SHARED_CACHE_TABLE)
      .select("status, content_type, body, updated_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    if (Date.now() - new Date(data.updated_at as string).getTime() >= ttlMs) return null;
    return { status: data.status as number, contentType: data.content_type as string, body: data.body as string };
  } catch {
    return null;
  }
}

async function writeSharedCache(cacheKey: string, status: number, contentType: string, body: string): Promise<void> {
  try {
    await supabase
      .from(SHARED_CACHE_TABLE)
      .upsert({ cache_key: cacheKey, status, content_type: contentType, body, updated_at: new Date().toISOString() }, { onConflict: "cache_key" });
  } catch {
    // best-effort
  }
}

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
  const ttlMs = resolveCacheTtlMs(endpoint, query);

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.status(cached.status).type(cached.contentType).send(cached.body);
    return;
  }

  // L2: shared across instances/viewers. Warm this instance's L1 from it so
  // subsequent same-instance requests skip the Supabase round trip.
  const shared = await readSharedCache(cacheKey, ttlMs);
  if (shared) {
    responseCache.set(cacheKey, { ...shared, expiresAt: Date.now() + ttlMs });
    res.status(shared.status).type(shared.contentType).send(shared.body);
    return;
  }

  try {
    const upstream = await fetch(`https://${TANK01_HOST}/${endpoint}?${query.toString()}`, {
      headers: { "x-rapidapi-host": TANK01_HOST, "x-rapidapi-key": apiKey },
      signal: AbortSignal.timeout(TANK01_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    const body = await upstream.text();
    if (upstream.ok) {
      responseCache.set(cacheKey, { status: upstream.status, contentType, body, expiresAt: Date.now() + ttlMs });
      await writeSharedCache(cacheKey, upstream.status, contentType, body);
    }
    res.status(upstream.status).type(contentType).send(body);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? "Tank01 request timed out" : "Tank01 is temporarily unavailable" });
  }
}
