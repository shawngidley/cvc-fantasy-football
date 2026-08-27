import express, { type Express, type Request, type Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { proxyTank01Request } from "../tank01Proxy";
import { syncTank01Scores } from "../tank01ScoringSync";

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

/** Builds the CVC Express app: body parsing, REST endpoints, and the tRPC API. No static serving and no `.listen()` — those are the caller's concern (local dev server vs. the Vercel serverless entry). */
export function createApp(): Express {
  const app = express();
  // CVC is deployed behind a TLS-terminating proxy (Vercel). Trust its
  // forwarded protocol so secure session cookies are handled consistently.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/tank01/:endpoint", proxyTank01Request);
  app.post("/api/scheduled/tank01-scoring-sync", runTank01ScoringSync);
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
