import { afterEach, describe, expect, it, vi } from "vitest";
import { computeKickoffUtc, getCvcLivePoints, isGameCurrentlyLive, isGameFetchEligible } from "./useCvcTank01LiveScores";

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

describe("getCvcLivePoints (using the real confirmed NE @ SEA live box-score shape)", () => {
  const rules = [
    { stat_key: "passing_yards", value: 0.04, applies_to_positions: ["QB"] },
    { stat_key: "passing_touchdown", value: 4, applies_to_positions: ["QB"] },
    { stat_key: "rushing_yards", value: 0.1, applies_to_positions: ["QB", "RB", "WR", "TE"] },
    { stat_key: "sack", value: 2, applies_to_positions: ["DST"] },
    { stat_key: "defensive_interception", value: 2, applies_to_positions: ["DST"] },
  ];

  it("computes real points for a player even though Tank01's playerStats entries have no pos field at all (the actual bug: CVC previously required a truthy position on the raw stat line, which Tank01 never provides, so every player was silently skipped)", () => {
    // Real Drake Maye stat line from the confirmed live NE@SEA box score -- note there
    // is no "pos" key anywhere in this object, matching the real Tank01 response.
    const drakeMayeStat = {
      Rushing: { rushAvg: "4.7", rushYds: "14", carries: "3", longRush: "10", rushTD: "0" },
      Passing: { passAttempts: "4", passTD: "0", passYds: "21", int: "0", passCompletions: "3" },
      teamID: "22", team: "NE", teamAbv: "NE", playerID: "4431452", longName: "Drake Maye",
    };
    const statLines = { [normalizeForTest("Drake Maye")]: drakeMayeStat as any };
    const points = getCvcLivePoints(statLines, "Drake Maye", "QB", "NE", rules as any);
    // 21 passing yards * 0.04 + 14 rushing yards * 0.1 = 0.84 + 1.4 = 2.24
    expect(points).toBeCloseTo(2.24, 2);
  });

  it("returns null (not 0) for a player with no live stat line yet", () => {
    expect(getCvcLivePoints({}, "Nobody Yet", "QB", "NE", rules as any)) .toBeNull();
  });

  it("looks up DST by the real team code, not a stray 'away'/'home' key (the actual bug: Tank01's DST object is keyed 'away'/'home' at the top level, with the real team code inside each entry's own teamAbv field)", () => {
    // Real NE defensive line from the confirmed live box score's top-level DST object.
    const neDefense = { teamAbv: "NE", teamID: "22", defTD: "0", defensiveInterceptions: "0", sacks: "1", fumblesRecovered: "0", ptsAllowed: "0", safeties: "0" };
    const statLines = { "dst:ne": { Defense: neDefense } as any };
    const points = getCvcLivePoints(statLines, "New England Patriots", "DST", "NE", rules as any);
    // 1 sack * 2 = 2
    expect(points).toBeCloseTo(2, 2);
  });
});

function normalizeForTest(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

describe("isGameFetchEligible (wide window -- which games are worth fetching a box score for at all)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is eligible right at kickoff", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff);
    expect(isGameFetchEligible("20260913", "1:00p")).toBe(true);
  });

  it("is NOT eligible before kickoff", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff - 60 * 60 * 1000); // 1 hour before kickoff
    expect(isGameFetchEligible("20260913", "1:00p")).toBe(false);
  });

  it("is still eligible several hours after a game has finished (the original bug this wide window fixed: a recently-completed game's stats never got fetched on a fresh page load with too narrow a window)", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 6 * 60 * 60 * 1000); // 6 hours after kickoff
    expect(isGameFetchEligible("20260913", "1:00p")).toBe(true);
  });

  it("is still eligible even more than 24 hours after kickoff -- THIS IS THE ACTUAL BUG: the previous 24h upper bound caused a Thursday-night game's stats to simply stop being fetched by Friday, even though that game's results still count for the entire CVC week (through Sunday/Monday games and the Friday correction window)", () => {
    const kickoff = computeKickoffUtc("20260910", "8:20p")!; // a real Thursday night kickoff
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 30 * 60 * 60 * 1000); // 30 hours later -- past the old 24h cutoff
    expect(isGameFetchEligible("20260910", "8:20p")).toBe(true);
  });

  it("stays eligible for several days after kickoff, matching a real CVC week's length", () => {
    const kickoff = computeKickoffUtc("20260910", "8:20p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 4 * 24 * 60 * 60 * 1000); // 4 days later (e.g. checking on Monday)
    expect(isGameFetchEligible("20260910", "8:20p")).toBe(true);
  });
});

describe("isGameCurrentlyLive (narrow window -- whether the recurring poll should keep rescheduling itself)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is live right at kickoff", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff);
    expect(isGameCurrentlyLive("20260913", "1:00p")).toBe(true);
  });

  it("is still live 4 hours after kickoff (mid/long game, including overtime buffer)", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 4 * 60 * 60 * 1000);
    expect(isGameCurrentlyLive("20260913", "1:00p")).toBe(true);
  });

  it("is no longer live 6 hours after kickoff -- THIS IS THE EXACT SCENARIO THAT CAUSED THE PRODUCTION INCIDENT: a game that ended hours ago is still fetch-eligible (so stats stay populated), but must NOT be treated as currently live, or the 30-second poll never stops for the full wide window", () => {
    const kickoff = computeKickoffUtc("20260913", "1:00p")!;
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 6 * 60 * 60 * 1000);
    expect(isGameFetchEligible("20260913", "1:00p")).toBe(true); // still fetched
    expect(isGameCurrentlyLive("20260913", "1:00p")).toBe(false); // but poll must stop rescheduling
  });
});
