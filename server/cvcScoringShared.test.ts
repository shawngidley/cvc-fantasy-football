import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit, normalizeTeam, resolveStatLine } from "./cvcScoringShared";

describe("mapWithConcurrencyLimit", () => {
  it("never has more than `limit` calls in flight at once", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async item => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return item * 2;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("returns results in the same order as the input, even though completion order can differ", async () => {
    // Items with longer delays are earlier in the input, so if results were ordered by
    // completion instead of input position, this would come back scrambled.
    const delays = [30, 20, 10, 5, 1];
    const results = await mapWithConcurrencyLimit(delays, 5, async delay => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return delay;
    });
    expect(results).toEqual(delays);
  });

  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async item => { seen.push(item); return item; });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles an empty input", async () => {
    const results = await mapWithConcurrencyLimit([], 5, async item => item);
    expect(results).toEqual([]);
  });

  it("works fine when the limit exceeds the number of items", async () => {
    const results = await mapWithConcurrencyLimit([1, 2], 10, async item => item * 10);
    expect(results).toEqual([10, 20]);
  });

  it("propagates a rejection from any single item", async () => {
    await expect(mapWithConcurrencyLimit([1, 2, 3], 2, async item => {
      if (item === 2) throw new Error("boom");
      return item;
    })).rejects.toThrow("boom");
  });
});

describe("normalizeTeam", () => {
  it("maps known Tank01 team-code variants to CVC's canonical form", () => {
    expect(normalizeTeam("KAN")).toBe("kc");
    expect(normalizeTeam("JAX")).toBe("jac");
  });

  it("lowercases an already-canonical code unchanged", () => {
    expect(normalizeTeam("SEA")).toBe("sea");
  });
});

describe("resolveStatLine (fix for a real, confirmed bug: two genuinely different real NFL players sharing the exact same name -- 'Antonio Williams', a 2026 rookie WR and a since-retired RB -- silently overwrote each other in a name-only-keyed stat line map, so both CVC player records ended up attributed to whichever one a box score happened to process last)", () => {
  const statLineA = { Receiving: { recYds: 64, receptions: 4, recTD: 1 } };
  const statLineB = { Rushing: { rushYds: 12, rushTD: 0 } };

  it("returns the correct player's stat line when a team-qualified key exists for a name shared by two different players", () => {
    const statLines = new Map<string, unknown>([
      ["antoniowilliams", statLineB], // whichever was processed last during the write -- the name-only key alone is ambiguous
      ["antoniowilliams|wsh", statLineA],
      ["antoniowilliams|nyg", statLineB],
    ]);
    const playerOnWashington = { display_name: "Antonio Williams", nfl_team: "WSH", position: "WR" };
    const playerOnGiants = { display_name: "Antonio Williams", nfl_team: "NYG", position: "WR" };
    expect(resolveStatLine(statLines, playerOnWashington)).toBe(statLineA);
    expect(resolveStatLine(statLines, playerOnGiants)).toBe(statLineB);
  });

  it("falls back to the name-only key when no team-qualified key exists (the common case -- most players don't share their name with anyone else)", () => {
    const statLines = new Map<string, unknown>([["aaronrodgers", statLineA]]);
    expect(resolveStatLine(statLines, { display_name: "Aaron Rodgers", nfl_team: "PIT", position: "QB" })).toBe(statLineA);
  });

  it("falls back to the name-only key when the caller has no team info at all", () => {
    const statLines = new Map<string, unknown>([["aaronrodgers", statLineA]]);
    expect(resolveStatLine(statLines, { display_name: "Aaron Rodgers", nfl_team: null, position: "QB" })).toBe(statLineA);
  });

  it("looks up a DST by team code, ignoring the display name entirely", () => {
    const statLines = new Map<string, unknown>([["dst:sea", statLineA]]);
    expect(resolveStatLine(statLines, { display_name: "Seattle Seahawks", nfl_team: "SEA", position: "DST" })).toBe(statLineA);
  });

  it("treats DEF the same as DST for the lookup", () => {
    const statLines = new Map<string, unknown>([["dst:sea", statLineA]]);
    expect(resolveStatLine(statLines, { display_name: "Seattle Seahawks", nfl_team: "SEA", position: "DEF" })).toBe(statLineA);
  });

  it("returns undefined when nothing matches at all", () => {
    const statLines = new Map<string, unknown>([["someoneelse", statLineA]]);
    expect(resolveStatLine(statLines, { display_name: "Nobody Here", nfl_team: "SEA", position: "WR" })).toBeUndefined();
  });
});
