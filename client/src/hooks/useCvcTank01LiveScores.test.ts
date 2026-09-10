import { describe, expect, it } from "vitest";
import { computeKickoffUtc } from "./useCvcTank01LiveScores";

describe("computeKickoffUtc", () => {
  it("correctly rolls an 8:20pm ET kickoff into the next UTC day (the exact overflow bug)", () => {
    // 8:20pm ET + 4hr offset = hour 24, which is not a valid string-built ISO hour and
    // previously produced an Invalid Date (NaN) -- confirmed directly: the old code's
    // `new Date("2026-09-13T24:20:00Z").getTime()` is NaN, while Date.UTC(2026, 8, 13,
    // 24, 20, 0) correctly resolves to 2026-09-14T00:20:00.000Z.
    const kickoff = computeKickoffUtc("20260913", "8:20p");
    expect(kickoff).not.toBeNull();
    expect(Number.isNaN(kickoff)).toBe(false);
    expect(new Date(kickoff!).toISOString()).toBe("2026-09-14T00:20:00.000Z");
  });

  it("correctly rolls a 10:15pm ET kickoff (Thursday/Monday night games) into the next UTC day", () => {
    const kickoff = computeKickoffUtc("20260910", "10:15p");
    expect(new Date(kickoff!).toISOString()).toBe("2026-09-11T02:15:00.000Z");
  });

  it("still works correctly for an ordinary early-afternoon kickoff (no overflow)", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p");
    expect(new Date(kickoff!).toISOString()).toBe("2026-09-13T17:00:00.000Z");
  });

  it("handles 12:00pm (noon) correctly", () => {
    const kickoff = computeKickoffUtc("20260913", "12:00p");
    expect(new Date(kickoff!).toISOString()).toBe("2026-09-13T16:00:00.000Z");
  });

  it("returns null for missing or malformed inputs instead of a garbage timestamp", () => {
    expect(computeKickoffUtc(undefined, "1:00p")).toBeNull();
    expect(computeKickoffUtc("20260913", undefined)).toBeNull();
    expect(computeKickoffUtc("2026091", "1:00p")).toBeNull(); // too short
    expect(computeKickoffUtc("20260913", "not-a-time")).toBeNull();
  });
});
