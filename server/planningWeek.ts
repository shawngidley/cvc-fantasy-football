import { getEasternDateParts, easternWallClockToUtc } from "./waiverResolutionTiming";
import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

/** Parses a Tank01 gameDate ("YYYYMMDD") + gameTime ("8:15p"/"1:00p") pair into its
 * real UTC kickoff instant, correctly accounting for whether that date falls in EDT
 * or EST -- unlike hasKickedOff's hardcoded "always UTC-4" assumption (tank01ScoringSync.ts),
 * which is only correct for the roughly half of the NFL season that falls in EDT
 * (through early November); every game from the DST fall-back through the end of the
 * season is off by an hour there. Uses the same proven Eastern-time conversion already
 * relied on for waiver timing. */
function parseKickoffUtc(gameDate?: string, gameTime?: string): Date | null {
  if (!gameDate || !gameTime || gameDate.length < 8) return null;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return null;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return easternWallClockToUtc(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)), Number(gameDate.slice(6, 8)), hour);
}

/**
 * CVC's planning-week cutoff: 9am ET the Tuesday before a week's actual first kickoff.
 * A genuinely separate concept from schedule_week.status (which tracks "have this
 * week's games actually been played," driven solely by the finalization sync and
 * must never move early) -- this answers "should owners already be planning for this
 * week," and advances on a fixed calendar schedule regardless of whether the games
 * have actually started. Finds the earliest kickoff among the week's games, walks
 * backward day by day (in Eastern calendar time) to the nearest Tuesday at or before
 * it, and returns 9am ET that day. Correctly handles a week whose first kickoff is a
 * Wednesday (an early-week international or holiday-shifted game) the same way as a
 * normal Thursday-starting week -- it still finds the Tuesday immediately before that
 * kickoff, not some other reference point. Returns null if none of the given games
 * have a parseable kickoff at all.
 */
export function computePlanningWeekCutoff(games: { gameDate?: string; gameTime?: string }[]): Date | null {
  const kickoffs = games.map(game => parseKickoffUtc(game.gameDate, game.gameTime)).filter((date): date is Date => date !== null);
  if (!kickoffs.length) return null;
  const earliestKickoff = new Date(Math.min(...kickoffs.map(date => date.getTime())));
  const kickoffDateParts = getEasternDateParts(earliestKickoff);
  // Walk backward from the kickoff's own Eastern calendar date to the nearest Tuesday
  // (weekday 2), at or before it -- 0 days back if the kickoff itself is already a
  // Tuesday (not a real NFL case, but keeps this correct in general), up to 6 days
  // back otherwise.
  for (let daysBack = 0; daysBack <= 6; daysBack++) {
    const noonUtcOnCandidateDate = Date.UTC(kickoffDateParts.year, kickoffDateParts.month - 1, kickoffDateParts.day - daysBack, 12);
    const candidateDate = getEasternDateParts(new Date(noonUtcOnCandidateDate));
    if (candidateDate.weekday === 2) return easternWallClockToUtc(candidateDate.year, candidateDate.month, candidateDate.day, 9);
  }
  return null; // unreachable -- every 7-day window contains exactly one Tuesday
}

/** Refreshes the planning-week cutoff cache for every schedule_week in a season, from
 * Tank01's per-week schedule data (a reference endpoint, refreshed only once a day
 * upstream -- well-suited to this, since kickoff schedules barely ever change once
 * set). Run once daily; not computed live on every page request. */
export async function syncPlanningWeekCutoffs(seasonId: string, seasonYear: number): Promise<{ weeksSynced: number }> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured for the planning-week cutoff sync.");
  const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number").eq("season_id", seasonId)) ?? [];
  let weeksSynced = 0;
  for (const week of weeks) {
    const games = await adapter.listGamesForWeek(week.week_number, seasonYear).catch(() => []);
    const cutoff = computePlanningWeekCutoff(games);
    if (!cutoff) continue; // e.g. this week's schedule isn't published by Tank01 yet
    unwrap(await supabase.from("cvc_week_planning_cutoff").upsert({ season_id: seasonId, week_number: week.week_number, cutoff_at: cutoff.toISOString(), synced_at: new Date().toISOString() }, { onConflict: "season_id,week_number" }).select("id").single());
    weeksSynced += 1;
  }
  return { weeksSynced };
}

/** Reads the planning-week cache: the highest week_number whose cutoff has already
 * passed, falling back to the season's first week if none have (or if the cache
 * hasn't been populated yet -- gracefully degrades rather than throwing, matching the
 * pattern established elsewhere this session for a table whose data may not have
 * synced yet). */
export async function getCurrentPlanningWeek(seasonId: string): Promise<number | null> {
  const result = await supabase.from("cvc_week_planning_cutoff").select("week_number, cutoff_at").eq("season_id", seasonId).order("week_number");
  const rows = result.error ? [] : (result.data ?? []);
  if (!rows.length) return null;
  const now = new Date().toISOString();
  const passed = rows.filter(row => row.cutoff_at <= now);
  if (passed.length) return Math.max(...passed.map(row => row.week_number));
  return Math.min(...rows.map(row => row.week_number));
}
