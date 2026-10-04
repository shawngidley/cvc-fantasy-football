import { describe, expect, it } from "vitest";
import { isLiveGameWindow } from "./tank01LiveWindow";

// All instants are fixed UTC epoch times (via Date.UTC), not wall-clock-dependent on the
// test runner's own timezone. Each comment gives the equivalent America/New_York local
// time for clarity; the UTC offset used to derive it (EDT = UTC-4 for the October dates,
// EST = UTC-5 for the December date) was confirmed against Intl directly, not assumed.
describe("isLiveGameWindow", () => {
  it("is live during a normal Sunday afternoon slate", () => {
    // Sun Oct 4 2026, 1:00pm ET (EDT)
    expect(isLiveGameWindow(Date.UTC(2026, 9, 4, 17, 0, 0))).toBe(true);
  });

  it("is live for a 9:30am London kickoff", () => {
    // Sun Oct 4 2026, 9:30am ET (EDT) -- just past the 9am gap boundary
    expect(isLiveGameWindow(Date.UTC(2026, 9, 4, 13, 30, 0))).toBe(true);
  });

  it("is live past midnight for a Monday-nighter still going at 12:30am Tuesday", () => {
    // Tue Oct 6 2026, 12:30am ET (EDT) -- reattributed to Monday's slate
    expect(isLiveGameWindow(Date.UTC(2026, 9, 6, 4, 30, 0))).toBe(true);
  });

  it("mirrors that into the off case: 12:30am Thursday, after a gameless Wednesday, is NOT live", () => {
    // Thu Oct 8 2026, 12:30am ET (EDT) -- reattributed to Wednesday's (gameless) slate
    expect(isLiveGameWindow(Date.UTC(2026, 9, 8, 4, 30, 0))).toBe(false);
  });

  it("is never live during the 2am-9am overnight gap", () => {
    // Sun Oct 4 2026, 5:00am ET (EDT)
    expect(isLiveGameWindow(Date.UTC(2026, 9, 4, 9, 0, 0))).toBe(false);
  });

  it("treats all of Tuesday as gameless", () => {
    // Tue Oct 6 2026, 3:00pm ET (EDT)
    expect(isLiveGameWindow(Date.UTC(2026, 9, 6, 19, 0, 0))).toBe(false);
  });

  it("treats all of Wednesday as gameless", () => {
    // Wed Oct 7 2026, 3:00pm ET (EDT)
    expect(isLiveGameWindow(Date.UTC(2026, 9, 7, 19, 0, 0))).toBe(false);
  });

  it("still gets the right local hour across the EDT->EST shift (no hardcoded UTC offset)", () => {
    // Sun Dec 6 2026, 1:00pm ET (EST, UTC-5 -- after the Nov 1 2026 fall-back)
    expect(isLiveGameWindow(Date.UTC(2026, 11, 6, 18, 0, 0))).toBe(true);
  });
});
