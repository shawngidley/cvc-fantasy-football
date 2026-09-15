import { applyEspnKickerOverrides, hasKickedOff, isGameFinal, selectWeekForSync, shouldFinalizeWeek } from "./tank01ScoringSync";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tank01LiveStats } from "@shared/cvcScoring";

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

describe("isGameFinal (ported from WRC's confirmed approach, at the commissioner's explicit request: CVC should finalize a week as soon as its games are actually done, the same way WRC does, not on a fixed calendar delay)", () => {
  it("is true for gameStatusCode 2 (final/completed)", () => {
    expect(isGameFinal({ gameStatusCode: 2 })).toBe(true);
    expect(isGameFinal({ gameStatusCode: "2" })).toBe(true); // checked as a string since the wire type isn't confirmed
  });

  it("is false for gameStatusCode 0 (not started) or 1 (in progress)", () => {
    expect(isGameFinal({ gameStatusCode: 0 })).toBe(false);
    expect(isGameFinal({ gameStatusCode: 1 })).toBe(false);
  });

  it("is false for a postponed (3) or suspended (4) game -- not actually done, even though it won't progress further on its own", () => {
    expect(isGameFinal({ gameStatusCode: 3 })).toBe(false);
    expect(isGameFinal({ gameStatusCode: 4 })).toBe(false);
  });

  it("falls back to the gameStatus text when gameStatusCode is missing", () => {
    expect(isGameFinal({ gameStatus: "Final" })).toBe(true);
    expect(isGameFinal({ gameStatus: "Final/OT" })).toBe(true);
    expect(isGameFinal({ gameStatus: "In Progress" })).toBe(false);
  });

  it("is false for a completely empty or missing body", () => {
    expect(isGameFinal(null)).toBe(false);
    expect(isGameFinal(undefined)).toBe(false);
    expect(isGameFinal({})).toBe(false);
  });
});

describe("shouldFinalizeWeek (no longer time-based at all -- finalizes purely once every one of the week's games is confirmed final)", () => {
  it("finalizes once every scheduled game is confirmed final", () => {
    expect(shouldFinalizeWeek(3, [true, true, true])).toBe(true);
  });

  it("does not finalize while any game is still not final, even if the rest are done", () => {
    expect(shouldFinalizeWeek(3, [true, true, false])).toBe(false); // e.g. Monday night still playing
  });

  it("does not finalize if not every scheduled game has even kicked off yet -- the exact bug this signature exists to prevent: gameStatuses only has an entry per game that's already started, so a week where only 2 of 3 games have kicked off (and those 2 happen to be done) must NOT be read as \"all final\"", () => {
    expect(shouldFinalizeWeek(3, [true, true])).toBe(false); // only 2 statuses for 3 scheduled games
  });

  it("does not finalize a week with no games scheduled at all", () => {
    expect(shouldFinalizeWeek(0, [])).toBe(false);
  });

  it("does not finalize on an empty gameStatuses list when games were actually scheduled", () => {
    expect(shouldFinalizeWeek(3, [])).toBe(false);
  });
});

describe("applyEspnKickerOverrides (finalization audit item 7: the OFFICIAL scoring path had no ESPN kicker-yardage override at all -- it trusted Tank01's raw Kicking.fgYds directly, the same field the client-side live-scoring code's own comment confirms is unreliable)", () => {
  const kickerEntry = (fgMade: number): Tank01LiveStats => ({ Kicking: { fgMade, fgYds: 0 } } as unknown as Tank01LiveStats) as Tank01LiveStats;

  it("overrides fgYds using real ESPN per-kick data, the same way live scoring already does", () => {
    const statLines = new Map<string, Tank01LiveStats>([
      ["justintucker", { ...kickerEntry(2), longName: "Justin Tucker" } as unknown as Tank01LiveStats],
    ]);
    const kickerEvents = [
      { playerName: "Justin Tucker", type: "fg" as const, outcome: "made" as const, yards: 47, text: "J.Tucker 47 Yd Field Goal" },
      { playerName: "Justin Tucker", type: "fg" as const, outcome: "made" as const, yards: 40, text: "J.Tucker 40 Yd Field Goal" },
    ];
    applyEspnKickerOverrides(statLines, kickerEvents);
    expect((statLines.get("justintucker") as any).Kicking.fgYds).toBe(87);
  });

  it("leaves a kicker's stat line untouched if ESPN parsing found no events for them", () => {
    const original = { ...kickerEntry(1), longName: "Some Kicker" } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["somekicker", original]]);
    applyEspnKickerOverrides(statLines, [{ playerName: "A Totally Different Kicker", type: "fg", outcome: "made", yards: 30, text: "x" }]);
    expect(statLines.get("somekicker")).toBe(original); // completely unchanged, not even a new object
  });

  it("never applies kicker data to a DST entry, even if kickerEvents is non-empty", () => {
    const dstEntry = { Defense: { sacks: 3 } } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["dst:sea", dstEntry]]);
    applyEspnKickerOverrides(statLines, [{ playerName: "Anyone", type: "fg", outcome: "made", yards: 40, text: "x" }]);
    expect(statLines.get("dst:sea")).toBe(dstEntry);
  });

  it("does not misapply FG/XP data to a non-kicker whose name happens to match (no fgMade field at all)", () => {
    const returnerEntry = { Kicking: { kickReturnYards: 25 }, longName: "Some Returner" } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["somereturner", returnerEntry]]);
    applyEspnKickerOverrides(statLines, [{ playerName: "Some Returner", type: "fg", outcome: "made", yards: 40, text: "x" }]);
    expect(statLines.get("somereturner")).toBe(returnerEntry); // no fgMade field -- not treated as a kicker
  });

  it("is a no-op when there are no kicker events at all (e.g. ESPN fetch failed entirely) -- Tank01's own values are left in place, same as before this fix existed", () => {
    const original = { ...kickerEntry(1), longName: "Some Kicker" } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["somekicker", original]]);
    applyEspnKickerOverrides(statLines, []);
    expect(statLines.get("somekicker")).toBe(original);
  });

  it("only overrides xpMade when ESPN has XP events, leaving fgYds as Tank01 provided when there are no FG events", () => {
    const original = { Kicking: { fgMade: 0, fgYds: 0, xpMade: 0 }, longName: "PAT Only Kicker" } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["patonlykicker", original]]);
    applyEspnKickerOverrides(statLines, [{ playerName: "PAT Only Kicker", type: "xp", outcome: "made", yards: null, text: "x" }]);
    const result = statLines.get("patonlykicker") as any;
    expect(result.Kicking.xpMade).toBe(1);
    expect(result.Kicking.fgYds).toBe(0); // untouched -- no FG events for this kicker
  });
});

describe("selectWeekForSync (finalization audit item 9: an already-final week could never be selected again for a normal sync, so a scoring fix could never actually reach it)", () => {
  const weeks = [
    { week_number: 1, status: "final" },
    { week_number: 2, status: "live" },
    { week_number: 3, status: "upcoming" },
    { week_number: 4, status: "upcoming" },
  ];

  it("without forceWeekNumber, selects the live week over any upcoming one", () => {
    expect(selectWeekForSync(weeks)?.week_number).toBe(2);
  });

  it("without forceWeekNumber, falls back to the first upcoming week when none is live", () => {
    const noLiveWeek = weeks.filter(week => week.status !== "live");
    expect(selectWeekForSync(noLiveWeek)?.week_number).toBe(3);
  });

  it("without forceWeekNumber, never selects an already-final week -- this is the exact confirmed gap", () => {
    const onlyFinal = [{ week_number: 1, status: "final" }];
    expect(selectWeekForSync(onlyFinal)).toBeNull();
  });

  it("with forceWeekNumber, selects the named week even though it's already final", () => {
    expect(selectWeekForSync(weeks, 1)?.week_number).toBe(1);
  });

  it("with forceWeekNumber, selects the named week regardless of status even when a live week also exists", () => {
    expect(selectWeekForSync(weeks, 4)?.week_number).toBe(4);
  });

  it("with forceWeekNumber, returns null for a week number that doesn't exist", () => {
    expect(selectWeekForSync(weeks, 999)).toBeNull();
  });
});
