import { describe, expect, it } from "vitest";
import { computeNextResolutionTime, nextEasternWeekdayAt, sameEasternDayAt } from "./waiverResolutionTiming";

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

describe("sameEasternDayAt", () => {
  it("returns the same Eastern calendar day at a different hour -- Sunday 9am -> 1pm", () => {
    const sunday9am = new Date("2026-09-06T13:00:00.000Z"); // Sun Sep 6 2026, 9am EDT
    const result = sameEasternDayAt(sunday9am, 13);
    expect(easternString(result)).toBe("Sun, 09/06/2026, 13:00");
    // 1pm EDT = 17:00 UTC
    expect(result.toISOString()).toBe("2026-09-06T17:00:00.000Z");
  });

  it("handles the fall DST boundary correctly for a same-day shift", () => {
    // Nov 1 2026 9am is already EST (see computeNextResolutionTime's DST test above).
    const sundayNov1_9am = new Date("2026-11-01T14:00:00.000Z");
    const result = sameEasternDayAt(sundayNov1_9am, 13);
    expect(easternString(result)).toBe("Sun, 11/01/2026, 13:00");
    expect(result.toISOString()).toBe("2026-11-01T18:00:00.000Z"); // 1pm EST = 18:00 UTC
  });
});

describe("nextEasternWeekdayAt", () => {
  it("finds the next Tuesday 9am ET after a Sunday 1pm close", () => {
    const sunday1pm = new Date("2026-09-06T17:00:00.000Z"); // Sun Sep 6 2026, 1pm EDT
    const result = nextEasternWeekdayAt(sunday1pm, 2, 9); // 2 = Tuesday
    expect(easternString(result)).toBe("Tue, 09/08/2026, 09:00");
  });

  it("skips to the following week's Tuesday if already past this week's", () => {
    const tuesday10am = new Date("2026-09-08T14:00:00.000Z"); // Tue Sep 8 2026, 10am EDT (past 9am)
    const result = nextEasternWeekdayAt(tuesday10am, 2, 9);
    expect(easternString(result)).toBe("Tue, 09/15/2026, 09:00");
  });
});

describe("the full confirmed real waiver cycle, end to end", () => {
  // Simulates the exact sequence: Tue 9am open (bid) -> Thu 9am award, immediate
  // reopen (bid) -> Sun 9am award, immediate open (free) -> Sun 1pm close -> gap ->
  // Tue 9am reopen (bid). This is the core business rule confirmed directly, so it's
  // tested as one continuous chain rather than isolated units only.
  it("walks through one full week correctly", () => {
    // Tuesday 9am ET bid period opens, closes Thursday 9am ET.
    const tuesdayOpen = new Date("2026-09-08T13:00:00.000Z");
    const thursdayClose = computeNextResolutionTime(tuesdayOpen);
    expect(easternString(thursdayClose)).toBe("Thu, 09/10/2026, 09:00");

    // Thursday 9am close -> immediately reopens (bid), closes Sunday 9am ET.
    const sundayClose = computeNextResolutionTime(thursdayClose);
    expect(easternString(sundayClose)).toBe("Sun, 09/13/2026, 09:00");

    // Sunday 9am close -> free period opens immediately, same day, closes 1pm ET.
    const freePeriodCloses = sameEasternDayAt(sundayClose, 13);
    expect(easternString(freePeriodCloses)).toBe("Sun, 09/13/2026, 13:00");

    // Free period's 1pm close -> next bid period doesn't open immediately; waits
    // until Tuesday 9am ET, a real gap of about 44 hours with nothing open.
    const nextTuesdayOpen = nextEasternWeekdayAt(freePeriodCloses, 2, 9);
    expect(easternString(nextTuesdayOpen)).toBe("Tue, 09/15/2026, 09:00");
    const gapHours = (nextTuesdayOpen.getTime() - freePeriodCloses.getTime()) / (1000 * 60 * 60);
    expect(gapHours).toBeCloseTo(44, 0);
  });
});
