import { describe, expect, it } from "vitest";
import { computeKickoffUtc } from "@shared/nflKickoff";

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("computeKickoffUtc uses the real Eastern offset for the game's date", () => {
  it("EDT (UTC-4) before Nov 1 2026", () => {
    expect(iso(computeKickoffUtc("20261025", "1:00p"))).toBe("2026-10-25T17:00:00.000Z");
  });
  it("EST (UTC-5) on and after Nov 1 2026", () => {
    expect(iso(computeKickoffUtc("20261101", "1:00p"))).toBe("2026-11-01T18:00:00.000Z");
    expect(iso(computeKickoffUtc("20261108", "8:20p"))).toBe("2026-11-09T01:20:00.000Z");
  });
  it("EST before and EDT after Mar 14 2027", () => {
    expect(iso(computeKickoffUtc("20270313", "1:00p"))).toBe("2027-03-13T18:00:00.000Z");
    expect(iso(computeKickoffUtc("20270314", "1:00p"))).toBe("2027-03-14T17:00:00.000Z");
  });
  it("keeps minutes and returns null for bad input", () => {
    expect(iso(computeKickoffUtc("20261025", "8:15p"))).toBe("2026-10-26T00:15:00.000Z");
    expect(computeKickoffUtc("2026", "1:00p")).toBeNull();
  });
});
