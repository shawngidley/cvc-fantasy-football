import { describe, expect, it } from "vitest";
import { extractCurrentTeam, syncTank01SeasonStats } from "./tank01SeasonStatsSync";

describe("Tank01 season stats sync", () => {
  it("skips gracefully when Tank01 is not configured", async () => {
    // This sandbox/CI environment has no TANK01_RAPIDAPI_KEY set, so the adapter
    // falls back to UnconfiguredNFLDataAdapter — confirms the sync degrades safely
    // rather than throwing when the provider isn't available.
    const result = await syncTank01SeasonStats("00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("skipped");
    expect(result.attempted).toBe(0);
    expect(result.teamsUpdated).toBe(0);
  });
});

describe("extractCurrentTeam", () => {
  it("checks several plausible Tank01 key names and normalizes to uppercase", () => {
    expect(extractCurrentTeam({ team: "kc" })).toBe("KC");
    expect(extractCurrentTeam({ teamAbv: "sf" })).toBe("SF");
    expect(extractCurrentTeam({ currentTeam: "buf" })).toBe("BUF");
  });

  it("returns null when no team-like field is present, rather than guessing", () => {
    expect(extractCurrentTeam({ someOtherField: "x" })).toBeNull();
  });

  it("treats a free-agent marker as no team rather than a literal team code", () => {
    expect(extractCurrentTeam({ team: "FA" })).toBeNull();
  });
});
