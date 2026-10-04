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
function nyHourAndWeekday(now: Date): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const hourPart = parts.find(part => part.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find(part => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(hourPart) % 24; // some locales render midnight as "24" rather than "0"
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayPart);
  return { hour, weekday };
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
  const date = typeof now === "number" ? new Date(now) : now;
  const { hour, weekday } = nyHourAndWeekday(date);
  if (hour >= 2 && hour < 9) return false; // overnight gap
  const effectiveWeekday = hour < 2 ? (weekday + 6) % 7 : weekday; // reattribute 12am-2am to the previous day
  if (effectiveWeekday === 2 || effectiveWeekday === 3) return false; // Tue/Wed: gameless (see caveat above)
  return true;
}
