import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { proxyTank01Request } from "../tank01Proxy";
import { runDstSeasonStatsSync, runNflTeamAssignmentSync, runTank01ScoringSync, runWaiverResolution } from "./scheduledHandlers";

/** Builds the CVC Express app: body parsing, REST endpoints, and the tRPC API. No static serving and no `.listen()` — those are the caller's concern (local dev server vs. the Vercel serverless entry). */
export function createApp(): Express {
  const app = express();
  // CVC is deployed behind a TLS-terminating proxy (Vercel). Trust its
  // forwarded protocol so secure session cookies are handled consistently.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/tank01/:endpoint", proxyTank01Request);
  // Kept here too for local dev / manual re-triggering via fetch with CRON_SECRET.
  // Vercel's actual production cron traffic hits the standalone functions at
  // api/scheduled/*.ts instead (see those files) -- Vercel cron paths need to resolve
  // to a real deployed function; this app's generic /api/:path* -> /api rewrite is not
  // guaranteed to apply to cron-originated requests the same way it does for browser
  // traffic (a documented Vercel routing precedence quirk: filesystem-based functions
  // take precedence over rewrites, and cron requests were confirmed 404ing against this
  // catch-all in production even after registering both GET and POST here).
  app.get("/api/scheduled/tank01-scoring-sync", runTank01ScoringSync);
  app.post("/api/scheduled/tank01-scoring-sync", runTank01ScoringSync);
  app.get("/api/scheduled/nfl-team-assignment-sync", runNflTeamAssignmentSync);
  app.post("/api/scheduled/nfl-team-assignment-sync", runNflTeamAssignmentSync);
  app.get("/api/scheduled/dst-season-stats-sync", runDstSeasonStatsSync);
  app.post("/api/scheduled/dst-season-stats-sync", runDstSeasonStatsSync);
  app.get("/api/scheduled/waiver-resolution", runWaiverResolution);
  app.post("/api/scheduled/waiver-resolution", runWaiverResolution);
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
