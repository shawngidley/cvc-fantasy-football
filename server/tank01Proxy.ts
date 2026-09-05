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

  try {
    const upstream = await fetch(`https://${TANK01_HOST}/${endpoint}?${query.toString()}`, {
      headers: { "x-rapidapi-host": TANK01_HOST, "x-rapidapi-key": apiKey },
      signal: AbortSignal.timeout(TANK01_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    res.status(upstream.status).type(contentType).send(await upstream.text());
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? "Tank01 request timed out" : "Tank01 is temporarily unavailable" });
  }
}
