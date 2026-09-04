const EASTERN_TZ = "America/New_York";

function getEasternDateParts(instant: Date): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: weekdayMap[parts.weekday] };
}

/** The UTC instant corresponding to a given wall-clock hour in America/New_York on a
 * given calendar date, correctly accounting for EST/EDT. Accurate except within the
 * ~1-2am window of a DST transition itself, which never coincides with 9am. */
function easternWallClockToUtc(year: number, month: number, day: number, hour: number): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(asIfUtc))) parts[part.type] = part.value;
  const reinterpretedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMs = reinterpretedAsUtc - asIfUtc;
  return new Date(asIfUtc - offsetMs);
}

/** Next Thursday-or-Sunday 9:00am America/New_York strictly after `from`. Both the
 * cut-lock ("must stay on your roster until the next bid awarding occurs the following
 * Thursday or Sunday") and the next waiver_period's closes_at are computed with this
 * same function, so they always agree. Vercel cron schedules run in UTC and can't
 * natively express "9am Eastern" year-round across DST, so the cron itself just runs
 * frequently (every 15 minutes) and this function is what actually determines the true
 * Eastern-time deadline that resolveOpenWaiverPeriod compares against. */
export function computeNextResolutionTime(from: Date): Date {
  const start = getEasternDateParts(from);
  for (let daysAhead = 0; daysAhead <= 8; daysAhead++) {
    const noonUtcOnCandidateDate = Date.UTC(start.year, start.month - 1, start.day + daysAhead, 12);
    const candidateDate = getEasternDateParts(new Date(noonUtcOnCandidateDate));
    if (candidateDate.weekday !== 4 && candidateDate.weekday !== 0) continue;
    const candidate = easternWallClockToUtc(candidateDate.year, candidateDate.month, candidateDate.day, 9);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Unreachable given the 8-day window always contains both a Thursday and a Sunday,
  // but keeps the return type non-nullable without an assertion.
  const fallback = new Date(from);
  fallback.setUTCDate(fallback.getUTCDate() + 7);
  return fallback;
}
