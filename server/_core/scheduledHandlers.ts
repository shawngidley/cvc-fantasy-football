import type { Request, Response } from "express";
import { syncTank01Scores } from "../tank01ScoringSync";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";

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
