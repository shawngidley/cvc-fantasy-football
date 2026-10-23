/** The one place CVC turns a Tank01 kickoff into a real instant. Used by the server's
 * game lock (hasKickedOff), the scoring cron, and the client live scores hook.
 *
 * Tank01 gives gameDate ("20261101") and gameTime ("1:00p"), both Eastern. The Eastern
 * offset is worked out with Intl for that date, so games after the first Sunday of
 * November (EST, UTC-5) and after the second Sunday of March (EDT, UTC-4) are both right.
 * Never hardcode an offset: that bug made locks and live polling an hour early after
 * the November clock change.
 *
 * It builds the result with Date.UTC arithmetic rather than a "...T24:20:00Z" string,
 * because an 8pm or later kickoff overflows an hour string and parses to Invalid Date.
 * Returns null if the inputs cannot be parsed. */
const EASTERN_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function easternOffsetMs(utcMs: number): number {
  const parts: Record<string, string> = {};
  for (const part of EASTERN_FORMAT.formatToParts(new Date(utcMs))) parts[part.type] = part.value;
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second));
  return shown - Math.floor(utcMs / 1000) * 1000;
}

export function easternWallClockToUtcMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Two passes so a date near a clock change still lands on the right offset.
  const first = asIfUtc - easternOffsetMs(asIfUtc);
  return asIfUtc - easternOffsetMs(first);
}

export function computeKickoffUtc(gameDate: string | undefined, gameTime: string | undefined): number | null {
  if (!gameDate || !gameTime || gameDate.length < 8) return null;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return null;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return easternWallClockToUtcMs(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)), Number(gameDate.slice(6, 8)), hour, Number(time[2]));
}
