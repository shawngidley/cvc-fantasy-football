import { runTank01ScoringSync } from "./scheduledHandlers";

// Standalone Vercel function, bundled to api/scheduled/tank01-scoring-sync.js (see the
// bundle:api script and vercel.json's functions config). Exists as its own literal file
// rather than being routed through the shared Express app's /api/:path* -> /api rewrite:
// Vercel cron jobs need their configured path to resolve to a real deployed function,
// and filesystem-based functions take precedence over rewrites. This exact path was
// confirmed 404ing in production (every 5 minutes, right on schedule) when it only
// existed behind that rewrite, even after registering both GET and POST on the Express
// route -- the request apparently never reached the Express app at all.
export default async function handler(req: any, res: any) {
  return runTank01ScoringSync(req, res);
}
