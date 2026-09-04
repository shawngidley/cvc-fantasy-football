import type { Request, Response } from "express";
import { syncTank01Scores } from "../tank01ScoringSync";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";
import { resolveOpenWaiverPeriod } from "../waiverResolution";

function checkCronAuth(req: Request, res: Response): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function runTank01ScoringSync(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
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
// not in-game -- no need to hit nflverse's CSV that often.
export async function runNflTeamAssignmentSync(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    res.json({ ok: true, ...(await syncNflTeamAssignments()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NFL team assignment sync failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

// Runs on the actual bid deadlines (Thursday & Sunday 9am ET, see vercel.json --
// scheduled a bit after 9am ET to give the 9am deadline a clean margin). Idempotent:
// resolveOpenWaiverPeriod() is a no-op if no period is currently past its close time, so
// firing this more often than strictly necessary (or re-triggering manually) is safe.
export async function runWaiverResolution(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const result = await resolveOpenWaiverPeriod();
    res.json({ ok: true, resolved: Boolean(result), ...(result ?? {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Waiver resolution failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
