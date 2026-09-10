import type { Request, Response } from "express";

const ESPN_TIMEOUT_MS = 8_000;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESPN_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dates}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      res.status(response.status).json({ error: `ESPN request failed with status ${response.status}` });
      return;
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "ESPN request failed" });
  } finally {
    clearTimeout(timeout);
  }
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESPN_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      res.status(response.status).json({ error: `ESPN request failed with status ${response.status}` });
      return;
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "ESPN request failed" });
  } finally {
    clearTimeout(timeout);
  }
}
