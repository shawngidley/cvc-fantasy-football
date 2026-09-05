import type { Request, Response } from "express";
import { syncTank01Scores } from "../tank01ScoringSync";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";
import { resolveOpenWaiverPeriod } from "../waiverResolution";
import { aggregateDstSeasonStats } from "../dstSeasonAggregation";
import { supabase, unwrap } from "../supabase";

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

// Same is_current-flag-with-fallback pattern used everywhere else in this codebase
// (see the season.is_current migration) -- duplicated locally rather than imported
// from routers/league.ts to avoid pulling in that entire (large) router file just for
// this one helper.
async function getCurrentSeason() {
  const league = unwrap(await supabase.from("league").select("id").eq("slug", "cvc-auction-football").single());
  const flagged = league ? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).eq("is_current", true).limit(1).maybeSingle()) : null;
  const season = flagged ?? (league ? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle()) : null);
  return season;
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

// Runs daily (see vercel.json). Determines "the last fully completed week" itself from
// schedule_week's status column (the highest week_number marked 'final'), then
// aggregates through that week -- so it naturally advances as 2026 progresses without
// needing a manually-updated week number, and stays a no-op if no week has finished yet.
export async function runDstSeasonStatsSync(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) { res.json({ ok: true, status: "skipped", reason: "No current season found." }); return; }
    const weeks = unwrap(await supabase.from("schedule_week").select("week_number, status").eq("season_id", season.id)) ?? [];
    const lastCompletedWeek = weeks.filter(week => week.status === "final").reduce((max, week) => Math.max(max, week.week_number), 0);
    if (!lastCompletedWeek) { res.json({ ok: true, status: "skipped", reason: "No week has completed yet this season." }); return; }
    const result = await aggregateDstSeasonStats(season.id, season.year, lastCompletedWeek);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("D/ST season stats sync failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
