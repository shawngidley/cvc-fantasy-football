import { correctionWindowClosed, hasKickedOff } from "./tank01ScoringSync";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("CVC Tank01 finalizer correction window", () => {
  it("keeps provider results provisional before Friday 16:00 UTC", () => {
    expect(correctionWindowClosed(new Date("2026-08-21T15:59:59.000Z"))).toBe(false);
  });

  it("finalizes only when the Friday 16:00 UTC correction window has closed", () => {
    expect(correctionWindowClosed(new Date("2026-08-21T16:00:00.000Z"))).toBe(true);
  });

  it("does not finalize automatically on other weekdays", () => {
    expect(correctionWindowClosed(new Date("2026-08-22T18:00:00.000Z"))).toBe(false);
  });
});

describe("hasKickedOff (gates which games this cron -- running every 5 minutes for the whole CVC week -- actually fetches a box score for)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is false for a game days in the future -- the actual bug: this cron previously fetched a box score for every game in the week on every single 5-minute run, regardless of whether it had even kicked off yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z")); // Thursday noon ET-ish
    expect(hasKickedOff("20260914", "1:00p")).toBe(false); // Sunday 1pm, days away
  });

  it("is true once kickoff has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T18:00:00.000Z")); // after a 1pm ET Sunday kickoff (17:00 UTC)
    expect(hasKickedOff("20260913", "1:00p")).toBe(true);
  });

  it("correctly handles an 8pm+ kickoff without the Date.UTC overflow bug", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T01:00:00.000Z")); // after an 8:20pm ET Thursday kickoff (00:20 UTC next day)
    expect(hasKickedOff("20260909", "8:20p")).toBe(true);
  });
});
