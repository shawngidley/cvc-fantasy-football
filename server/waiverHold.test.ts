import { describe, expect, it } from "vitest";
import { getWaiverAwardDate, hasClearedWaiverHold } from "./waiverHold";

// Sept 2026 reference resolutions (EDT, so 9am ET = 13:00 UTC):
//   Thu Sep 10, Sun Sep 13, Wed Sep 16, Thu Sep 17, Sun Sep 20, Thu Sep 24.

describe("hasClearedWaiverHold", () => {
  it("treats a null/undefined droppedAt as always cleared", () => {
    expect(hasClearedWaiverHold(null, new Date("2026-09-16T18:00:00Z"))).toBe(true);
    expect(hasClearedWaiverHold(undefined, new Date("2026-09-16T18:00:00Z"))).toBe(true);
  });

  it("is false before 48 hours and true at/after", () => {
    const cut = new Date("2026-09-10T13:00:00Z");
    expect(hasClearedWaiverHold(cut, new Date("2026-09-12T12:59:00Z"))).toBe(false); // 47h59m
    expect(hasClearedWaiverHold(cut, new Date("2026-09-12T13:00:00Z"))).toBe(true); // exactly 48h
    expect(hasClearedWaiverHold(cut, new Date("2026-09-13T00:00:00Z"))).toBe(true);
  });

  it("accepts a string timestamp as stored in the database", () => {
    expect(hasClearedWaiverHold("2026-09-10T13:00:00Z", new Date("2026-09-12T14:00:00Z"))).toBe(true);
    expect(hasClearedWaiverHold("2026-09-10T13:00:00Z", new Date("2026-09-11T14:00:00Z"))).toBe(false);
  });
});

describe("getWaiverAwardDate", () => {
  it("cut Thursday 9am ET -> awarded Sunday 9am ET", () => {
    const cut = new Date("2026-09-10T13:00:00Z");
    const now = new Date("2026-09-10T13:01:00Z");
    expect(getWaiverAwardDate(cut, now).toISOString()).toBe("2026-09-13T13:00:00.000Z");
  });

  it("cut Sunday 9am ET -> awarded the following Thursday 9am ET", () => {
    const cut = new Date("2026-09-13T13:00:00Z");
    const now = new Date("2026-09-13T13:01:00Z");
    expect(getWaiverAwardDate(cut, now).toISOString()).toBe("2026-09-17T13:00:00.000Z");
  });

  it("cut Wednesday 2pm ET -> awarded Sunday 9am ET", () => {
    const cut = new Date("2026-09-16T18:00:00Z"); // Wed 2pm ET
    const now = new Date("2026-09-16T18:01:00Z");
    expect(getWaiverAwardDate(cut, now).toISOString()).toBe("2026-09-20T13:00:00.000Z");
  });

  it("cut Friday morning -> 48h lands Sunday after that award, so Thursday", () => {
    const cut = new Date("2026-09-11T14:00:00Z"); // Fri 10am ET
    const now = new Date("2026-09-11T14:01:00Z");
    // 48h -> Sun 10am ET, which is AFTER Sunday's 9am award, so the next is Thursday.
    expect(getWaiverAwardDate(cut, now).toISOString()).toBe("2026-09-17T13:00:00.000Z");
  });

  it("a player not recently cut is awarded at the next resolution", () => {
    const now = new Date("2026-09-16T18:00:00Z"); // Wed
    expect(getWaiverAwardDate(null, now).toISOString()).toBe("2026-09-17T13:00:00.000Z"); // next Thu
  });
});
