import { describe, expect, it } from "vitest";
import { syncTank01SeasonStats } from "./tank01SeasonStatsSync";

describe("Tank01 season stats sync", () => {
  it("skips gracefully when Tank01 is not configured", async () => {
    // This sandbox/CI environment has no TANK01_RAPIDAPI_KEY set, so the adapter
    // falls back to UnconfiguredNFLDataAdapter — confirms the sync degrades safely
    // rather than throwing when the provider isn't available.
    const result = await syncTank01SeasonStats("00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("skipped");
    expect(result.attempted).toBe(0);
  });
});
