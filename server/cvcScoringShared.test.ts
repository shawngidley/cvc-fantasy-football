import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit, normalizeTeam } from "./cvcScoringShared";

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
