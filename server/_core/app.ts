import express, { type Express, type Request, type Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { proxyTank01Request } from "../tank01Proxy";
import { syncTank01Scores } from "../tank01ScoringSync";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";

async function runTank01ScoringSync(req: Request, res: Response) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    res.json({ ok: true, ...(await syncTank01Scores()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Tank01 scoring sync failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

// Same auth pattern as runTank01ScoringSync above. Runs daily rather than every 5
// minutes (see vercel.json) since NFL team assignments only change on trades/signings,
// not in-game -- no need to hit nflverse's CSV that often. Was previously
// commissioner-trigger-only in the Commissioner Panel; that button still exists and
// still works, this just removes the need to remember to click it.
async function runNflTeamAssignmentSync(req: Request, res: Response) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    res.json({ ok: true, ...(await syncNflTeamAssignments()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NFL team assignment sync failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

/** Builds the CVC Express app: body parsing, REST endpoints, and the tRPC API. No static serving and no `.listen()` — those are the caller's concern (local dev server vs. the Vercel serverless entry). */
export function createApp(): Express {
  const app = express();
  // CVC is deployed behind a TLS-terminating proxy (Vercel). Trust its
  // forwarded protocol so secure session cookies are handled consistently.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/tank01/:endpoint", proxyTank01Request);
  // Registered for both methods: Vercel's native cron trigger always sends GET (confirmed
  // via Vercel's own docs), never POST -- a POST-only handler here would mean the
  // schedule in vercel.json silently never actually fires, which is very likely why
  // manual browser-console triggering became a necessary workaround pattern for this
  // endpoint previously. POST is kept for manual re-triggering with CRON_SECRET.
  app.get("/api/scheduled/tank01-scoring-sync", runTank01ScoringSync);
  app.post("/api/scheduled/tank01-scoring-sync", runTank01ScoringSync);
  app.get("/api/scheduled/nfl-team-assignment-sync", runNflTeamAssignmentSync);
  app.post("/api/scheduled/nfl-team-assignment-sync", runNflTeamAssignmentSync);
  // Defense-in-depth alongside forcing POST client-side (main.tsx): explicitly tell any
  // intermediate cache (browser, proxy, CDN) never to store tRPC responses. Confirmed
  // suspicious in production: a GET-based tRPC query kept returning a stale, verified-
  // wrong result even after the underlying database data was confirmed correct and
  // browser-side caches (service worker, site data) were cleared.
  app.use("/api/trpc", (_req, res, next) => { res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate"); next(); });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      allowMethodOverride: true,
    })
  );
  return app;
}
