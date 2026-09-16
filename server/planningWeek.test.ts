import { describe, expect, it } from "vitest";
import { computePlanningWeekCutoff } from "./planningWeek";

function easternString(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

describe("computePlanningWeekCutoff (CVC's own planning-week mechanism, matching WRC's: 9am ET the Tuesday before a week's actual first kickoff, calculated live from that week's real schedule data -- not a fixed calendar-week assumption)", () => {
  it("finds the Tuesday before a normal Thursday-starting week, during EDT (daylight time)", () => {
    // A normal week: Thursday night opener, Sunday slate, Monday night closer.
    const games = [
      { gameDate: "20260910", gameTime: "8:20p" }, // Thursday night, week's earliest kickoff
      { gameDate: "20260913", gameTime: "1:00p" }, // Sunday
      { gameDate: "20260914", gameTime: "8:15p" }, // Monday night
    ];
    const cutoff = computePlanningWeekCutoff(games);
    expect(cutoff).not.toBeNull();
    expect(easternString(cutoff!)).toBe("Tue, 09/08/2026, 09:00"); // the Tuesday before that Thursday
  });

  it("finds the Tuesday before an early-week Wednesday-starting week (an international or holiday-shifted game) -- not some other reference point", () => {
    const games = [
      { gameDate: "20261125", gameTime: "8:15p" }, // a Wednesday night opener (Thanksgiving week shift)
      { gameDate: "20261129", gameTime: "1:00p" },
    ];
    const cutoff = computePlanningWeekCutoff(games);
    expect(cutoff).not.toBeNull();
    expect(easternString(cutoff!)).toBe("Tue, 11/24/2026, 09:00"); // the Tuesday immediately before that Wednesday, not the week before
  });

  it("correctly returns 9am EST (not EDT) for a cutoff that falls after the fall DST transition", () => {
    // Kickoff in December, well after the fall-back -- ET is UTC-5 (EST) at this point.
    const games = [{ gameDate: "20261210", gameTime: "8:15p" }]; // a Thursday in December
    const cutoff = computePlanningWeekCutoff(games);
    expect(cutoff).not.toBeNull();
    expect(easternString(cutoff!)).toBe("Tue, 12/08/2026, 09:00");
    // 9am EST = 14:00 UTC (not 13:00, which would be the EDT offset)
    expect(cutoff!.toISOString()).toBe("2026-12-08T14:00:00.000Z");
  });

  it("uses only the EARLIEST kickoff among the week's games, ignoring later ones", () => {
    const games = [
      { gameDate: "20260913", gameTime: "1:00p" }, // Sunday -- listed first, but not earliest
      { gameDate: "20260910", gameTime: "8:20p" }, // Thursday -- actually earliest
    ];
    const cutoff = computePlanningWeekCutoff(games);
    expect(easternString(cutoff!)).toBe("Tue, 09/08/2026, 09:00");
  });

  it("skips games with unparseable date/time and still uses the earliest valid one", () => {
    const games = [
      { gameDate: undefined, gameTime: undefined },
      { gameDate: "20260910", gameTime: "8:20p" },
    ];
    const cutoff = computePlanningWeekCutoff(games);
    expect(easternString(cutoff!)).toBe("Tue, 09/08/2026, 09:00");
  });

  it("returns null when no game in the list has a parseable kickoff at all", () => {
    expect(computePlanningWeekCutoff([{ gameDate: undefined, gameTime: undefined }])).toBeNull();
    expect(computePlanningWeekCutoff([])).toBeNull();
  });
});
