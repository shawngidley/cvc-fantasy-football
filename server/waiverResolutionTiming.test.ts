import { describe, expect, it } from "vitest";
import { computeNextResolutionTime } from "./waiverResolutionTiming";

// Helper: format a UTC instant as an America/New_York wall-clock string for readable
// assertions.
function easternString(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

describe("computeNextResolutionTime", () => {
  it("finds the very next Thursday 9am ET from a midweek date (EDT, daylight time)", () => {
    // Wed Sep 2, 2026, noon ET -- during EDT (UTC-4)
    const from = new Date("2026-09-02T16:00:00Z");
    const result = computeNextResolutionTime(from);
    expect(easternString(result)).toBe("Thu, 09/03/2026, 09:00");
    // 9am EDT = 13:00 UTC
    expect(result.toISOString()).toBe("2026-09-03T13:00:00.000Z");
  });

  it("finds the following Sunday 9am ET when starting from just after Thursday's deadline", () => {
    const from = new Date("2026-09-03T13:00:00.000Z"); // exactly Thursday 9am ET
    const result = computeNextResolutionTime(from);
    expect(easternString(result)).toBe("Sun, 09/06/2026, 09:00");
  });

  it("finds the next Thursday 9am ET from just after a Sunday's resolution", () => {
    const from = new Date("2026-09-06T13:00:00.000Z"); // exactly Sunday 9am ET
    const result = computeNextResolutionTime(from);
    expect(easternString(result)).toBe("Thu, 09/10/2026, 09:00");
  });

  it("crosses the fall DST boundary correctly (EDT -> EST)", () => {
    // DST ends Sun Nov 1, 2026. A Thursday before the change should still compute the
    // following Sunday correctly even though the UTC offset changes mid-way.
    const from = new Date("2026-10-29T13:00:00.000Z"); // Thu Oct 29 9am EDT
    const result = computeNextResolutionTime(from);
    expect(easternString(result)).toBe("Sun, 11/01/2026, 09:00");
    // Nov 1 2026 is still EDT until 2am local, so 9am that day is already EST (UTC-5)
    // per US rules (clocks fall back at 2am) -- 9am EST = 14:00 UTC.
    expect(result.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("does not return a time at or before the input", () => {
    const from = new Date("2026-09-06T13:00:00.000Z"); // exactly a resolution instant
    const result = computeNextResolutionTime(from);
    expect(result.getTime()).toBeGreaterThan(from.getTime());
  });
});
