// Whether an NFL game could plausibly be live right now, in America/New_York wall-clock
// time -- used only to pick a cache TTL (a long, cheap one off-window; a short,
// just-under-the-poll-interval one in-window). Getting this wrong in either direction
// only costs either staleness or an extra Tank01 call; it is NOT the authority on
// whether any specific game has actually started (that's hasKickedOff in
// tank01ScoringSync.ts and isGameCurrentlyLive in useCvcTank01LiveScores.ts, both of
// which parse a real game's own static gameDate/gameTime -- this function knows nothing
// about any particular game's schedule at all).
//
// Deliberately timezone-aware via Intl rather than a hardcoded UTC offset (the bug that
// broke kickoffUtcMs/computeKickoffUtc after a DST fall-back): asking Intl for the
// wall-clock hour and weekday in America/New_York handles the EDT/EST transition
// automatically, so this doesn't need its own DST table.
// Hours 0 and 1 (12:00am-1:59am ET) still belong to the PREVIOUS day's slate: a Sunday
// night game running long is still a Sunday game at 12:30am Monday, and a Monday night
// game in overtime is still Monday Night Football at 12:30am Tuesday. This one constant
// and nySlate() below are the single source of that rule -- both isLiveGameWindow and the
// proxy's past-day box-score check (tank01Proxy.ts) read it, so they cannot drift apart
// (a past-day check built on the raw ET date instead froze a live game's box score for
// 12 hours the moment the clock crossed midnight).
const SLATE_ROLLOVER_HOUR = 2;

/** The America/New_York "slate" at an instant: the wall-clock hour, plus the calendar date
 * and weekday of the slate that instant belongs to (the previous calendar day during
 * 12:00am-1:59am). The roll-back goes through a UTC-anchored Date, not a decremented day
 * number, so it crosses month and year boundaries correctly (Nov 1 12:30am -> Oct 31,
 * Jan 1 12:30am -> Dec 31). */
export function nySlate(now: Date | number): { hour: number; slateDate: string; slateWeekday: number } {
  const date = typeof now === "number" ? new Date(now) : now;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value ?? "0");
  const hour = read("hour") % 24; // some locales render midnight as "24" rather than "0"
  const dayOffset = hour < SLATE_ROLLOVER_HOUR ? -1 : 0;
  const slate = new Date(Date.UTC(read("year"), read("month") - 1, read("day") + dayOffset));
  const slateDate = `${slate.getUTCFullYear()}${String(slate.getUTCMonth() + 1).padStart(2, "0")}${String(slate.getUTCDate()).padStart(2, "0")}`;
  return { hour, slateDate, slateWeekday: slate.getUTCDay() };
}

/**
 * True whenever an NFL game could plausibly be live, false when it's safe to assume
 * nothing is (so the caller can fall back to a long cache TTL instead of a short one).
 *
 * Boundary logic, all in America/New_York:
 * - 12:00am-1:59am is attributed to the PREVIOUS day's slate before the day check runs,
 *   so a Monday-night game still in overtime at 12:30am Tuesday counts as live (it's
 *   still Monday Night Football) rather than flipping to the long TTL mid-game.
 * - 2:00am-8:59am is never live, any day -- by 2am the latest game has long since ended.
 * - After that reattribution, Tuesday and Wednesday are treated as gameless. This is a
 *   convenience, not a guarantee: if a game is ever rescheduled onto a Tuesday or
 *   Wednesday (weather, an emergency flex), this returns false for it and that one
 *   game's score caches for up to 15 minutes instead of 50 seconds -- stale, not broken.
 * - Everything else (Thu/Fri/Sat/Sun/Mon, effectively ~9am-2am after reattribution) is a
 *   live window.
 */
export function isLiveGameWindow(now: Date | number = Date.now()): boolean {
  const { hour, slateWeekday } = nySlate(now);
  if (hour >= SLATE_ROLLOVER_HOUR && hour < 9) return false; // overnight gap
  if (slateWeekday === 2 || slateWeekday === 3) return false; // Tue/Wed: gameless (see caveat above)
  return true;
}
