import { applyEspnKickerOverrides, correctionWindowClosed, hasKickedOff, shouldFinalizeWeek } from "./tank01ScoringSync";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tank01LiveStats } from "@shared/cvcScoring";

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

describe("shouldFinalizeWeek", () => {
  afterEach(() => { vi.useRealTimers(); });

  const week1Games = [
    { gameDate: "20260909", gameTime: "8:20p" }, // Thursday night
    { gameDate: "20260913", gameTime: "1:00p" }, // Sunday early
    { gameDate: "20260914", gameTime: "8:15p" }, // Monday night, the week's last game
  ];

  it("does NOT finalize on the Friday WITHIN the week's own game window -- THIS IS THE ACTUAL BUG: correctionWindowClosed(now) alone is already true here (it's Friday 4pm+ UTC), but Sunday and Monday's games haven't happened yet, so finalizing here would lock in a week 3-4 days before it's actually done", () => {
    const fridayWithinWeek = new Date("2026-09-11T17:00:00.000Z"); // Friday, but Thu already played, Sun/Mon still ahead
    expect(correctionWindowClosed(fridayWithinWeek)).toBe(true); // confirms the old, insufficient check alone says "go"
    expect(shouldFinalizeWeek(week1Games, fridayWithinWeek)).toBe(false); // the fixed check correctly blocks it
  });

  it("DOES finalize on the following Friday, once every game in the week has actually kicked off", () => {
    const followingFriday = new Date("2026-09-18T17:00:00.000Z");
    expect(shouldFinalizeWeek(week1Games, followingFriday)).toBe(true);
  });

  it("does not finalize before Friday 4pm UTC even if every game has already kicked off", () => {
    const earlyMonday = new Date("2026-09-14T21:00:00.000Z"); // after Monday night kickoff, but not yet Friday
    expect(shouldFinalizeWeek(week1Games, earlyMonday)).toBe(false);
  });

  it("does not finalize a week with no games scheduled at all", () => {
    const followingFriday = new Date("2026-09-18T17:00:00.000Z");
    expect(shouldFinalizeWeek([], followingFriday)).toBe(false);
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
