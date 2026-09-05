import { describe, expect, it } from "vitest";
import { extractCurrentTeam, extractSeasonStats, syncTank01SeasonStats } from "./tank01SeasonStatsSync";

const KICKER_RULES = [
  { stat_key: "extra_point", value: 1.0, applies_to_positions: ["K"] },
  { stat_key: "field_goal_yard", value: 0.1, applies_to_positions: ["K"] },
];

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

describe("extractSeasonStats", () => {
  it("does not silently score field goals as zero when Tank01 provides no yardage field -- confirmed live bug: Brandon Aubrey (36 FGM, 47 XPM) synced as fantasy_points=47.00, exactly the XP total alone with zero FG contribution", () => {
    const row = { stats: { Kicking: { fgMade: 36, xpMade: 47 }, gamesPlayed: 17 } };
    const stats = extractSeasonStats(row, "K", KICKER_RULES);
    expect(stats.fg_made).toBe(36);
    expect(stats.xp_made).toBe(47);
    // Old (broken) behavior: 47 XP * 1.0 + 0 (no fgYds at all) = 47.00 exactly.
    expect(stats.fantasy_points).not.toBeCloseTo(47, 1);
    // Fixed: estimates fgYds = 36 * 38 = 1368, worth 136.8 at 0.1/yard, plus 47 XP.
    expect(stats.fantasy_points).toBeCloseTo(136.8 + 47, 1);
  });

  it("trusts real field goal yardage when Tank01 does provide it, rather than always estimating", () => {
    const row = { stats: { Kicking: { fgMade: 5, xpMade: 3, fgYds: 210 }, gamesPlayed: 4 } };
    const stats = extractSeasonStats(row, "K", KICKER_RULES);
    // 210 real yards * 0.1 + 3 XP * 1.0 = 24.0, not the 5*38=190-yard estimate (22.0).
    expect(stats.fantasy_points).toBeCloseTo(21 + 3, 1);
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
