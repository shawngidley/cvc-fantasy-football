import type { Request, Response } from "express";
import { syncTank01Scores } from "../tank01ScoringSync";
import { syncNflTeamAssignments } from "../nflTeamAssignmentSync";
import { resolveOpenWaiverPeriod } from "../waiverResolution";
import { aggregateDstSeasonStats } from "../dstSeasonAggregation";
import { syncNflTeamSchedules } from "../nflTeamScheduleSync";
import { archiveFantasyProsNews } from "../fantasyProsArchive";
import { attachFantasyProsPlayerNames } from "../fantasyProsNewsNames";
import { getFantasyProsNews, getFantasyProsRanks } from "../fantasyProsNews";
import { backfillHistoricalSeasonStats } from "../cvcSeasonStatsHistorical";
import { rebuildSeasonStatsCurrentForAllPlayers } from "../cvcPlayerWeeklyStats";
import { syncPlanningWeekCutoffs } from "../planningWeek";
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

// Runs daily (see vercel.json). NFL schedules essentially never change mid-week, so
// there's no need to compute this live per page view -- see syncNflTeamSchedules for
// the full reasoning (32 external API calls per Free Agents page load, replaced by
// one shared cached table).
export async function runTeamScheduleSync(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) { res.json({ ok: true, status: "skipped", reason: "No current season found." }); return; }
    const [teamScheduleResult, planningWeekResult] = await Promise.all([
      syncNflTeamSchedules(season.year),
      syncPlanningWeekCutoffs(season.id, season.year).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    ]);
    res.json({ ok: true, ...teamScheduleResult, planningWeekCutoff: planningWeekResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NFL team schedule sync failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

/** Daily snapshot of the live FantasyPros news feed into the 30-day rolling archive,
 * matching WRC's collectFantasyProsArchive -- FantasyPros' live /nfl/news endpoint
 * only returns its most recent ~100 items league-wide with no date-range guarantee, so
 * a lower-profile player's news can fall off the window entirely between checks.
 * Running this daily builds up a reliable history the live feed alone can't provide. */
export async function runFantasyProsArchiveCollection(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) { res.json({ ok: true, status: "skipped", reason: "No current season found." }); return; }
    const eligible = ["QB", "RB", "WR", "TE", "K"];
    const [news, ...rankGroups] = await Promise.all([
      getFantasyProsNews(100),
      ...eligible.map(position => getFantasyProsRanks(season.year, position, 1)),
    ]);
    const result = await archiveFantasyProsNews(attachFantasyProsPlayerNames(news, rankGroups.flat()));
    res.json({ ok: true, fetched: news.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("FantasyPros archive collection failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

// Runs daily, once per historic year (see vercel.json -- three separate cron entries,
// same path with a different ?year= query string each), matching WRC's exact
// approach: a single-year-per-invocation endpoint, not one invocation looping through
// every year at once. Idempotent and self-limiting either way --
// backfillHistoricalSeasonStats skips any player who already has a row for that
// specific year, so once every eligible player has been backfilled for a given year
// this naturally becomes a no-op every day after, the same self-healing shape as
// runDstSeasonStatsSync above.
export async function runHistoricalSeasonStatsBackfill(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      res.status(400).json({ error: "A valid ?year= query parameter is required." });
      return;
    }
    const result = await backfillHistoricalSeasonStats(year, 40);
    res.json({ ok: true, year, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Historical season stats backfill failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}

// Runs daily (see vercel.json). A safety net on top of the inline, incremental refresh
// that already runs right after each week's finalization (tank01ScoringSync.ts) --
// covers the case where that inline refresh silently failed for some player (a
// transient error, a timing issue) by re-aggregating everyone's cvc_player_weekly_stat
// rows from scratch. Fast and idempotent (a plain upsert), so running it daily
// regardless of whether anything actually changed is cheap.
export async function runSeasonStatsCurrentRebuild(req: Request, res: Response) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) { res.json({ ok: true, status: "skipped", reason: "No current season found." }); return; }
    const result = await rebuildSeasonStatsCurrentForAllPlayers(season.id);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Season stats current rebuild failed", error);
    res.status(500).json({ error: message, timestamp: new Date().toISOString() });
  }
}
