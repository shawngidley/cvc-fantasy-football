import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { from: vi.fn() },
  unwrap: (value: unknown) => value,
}));

const mockRules = [
  { stat_key: "sack", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_interception", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_touchdown", value: 6, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_0", value: 15, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_1_6", value: 10, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_7_13", value: 5, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_14_20", value: 3, applies_to_positions: ["DST"] },
];

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe("dstSeasonAggregation", () => {
  it("sums per-game points-allowed tier bonuses correctly instead of averaging a season total (the exact bug the feature exists to avoid)", async () => {
    // Two games for the same team: one shutout (0 pts allowed -> 15pt tier) and one
    // blowout loss (35 pts allowed -> no tier bonus under CVC's real rules, since only
    // 0/1-6/7-13/14-20 have a configured bonus). A season-average approach would see
    // (0+35)/2 = 17.5 avg -> wrongly land in the 14-20 tier (3pts) for both games.
    // The correct per-game sum is 15 + 0 = 15, not 3 + 3 = 6 or any average-based figure.
    const gamesByWeek: Record<number, { gameID: string }[]> = { 1: [{ gameID: "g1" }], 2: [{ gameID: "g2" }] };
    const boxByGame: Record<string, { teamStats: Record<string, Record<string, unknown>> }> = {
      g1: { teamStats: { KC: { sacks: 3, defensiveInterceptions: 1, defTD: 0, ptsAgainst: 0 } } },
      g2: { teamStats: { KC: { sacks: 2, defensiveInterceptions: 0, defTD: 0, ptsAgainst: 35 } } },
    };

    let capturedUpsert: Record<string, unknown> | null = null;
    vi.doMock("./nflDataAdapter", async () => {
      class FakeTank01Adapter {
        async listGamesForWeek(week: number) { return gamesByWeek[week] ?? []; }
        async getBoxScore(gameId: string) { return boxByGame[gameId]; }
      }
      return {
        getNFLDataAdapter: () => new FakeTank01Adapter(),
        Tank01NFLDataAdapter: FakeTank01Adapter,
      };
    });
    vi.doMock("./supabase", () => ({
      supabase: {
        from: (table: string) => {
          if (table === "scoring_rule") return { select: () => ({ eq: () => Promise.resolve({ data: mockRules, error: null }) }) };
          if (table === "player") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "p1", nfl_team: "KC" }], error: null }) }) };
          if (table === "player_season_stat") return { upsert: (payload: Record<string, unknown>) => { capturedUpsert = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: "row1" }, error: null }) }) }; } };
          throw new Error(`Unexpected table in test: ${table}`);
        },
      },
      unwrap: (value: { data: unknown; error: unknown }) => value.data,
    }));

    const { aggregateDstSeasonStats } = await import("./dstSeasonAggregation");
    const result = await aggregateDstSeasonStats("season-1", 2025, 2);
    expect(result.status).toBe("completed");
    expect(result.weeksProcessed).toBe(2);
    expect(result.teamsUpdated).toBe(1);
    // Week 1: 3 sacks*2 + 1 int*2 + 0-pts-allowed tier (15) = 23
    // Week 2: 2 sacks*2 + 0 int*2 + 35-pts-allowed (no configured tier, 0 bonus) = 4
    // Correct sum = 27. A season-average approach (17.5 avg -> wrongly in 14-20 tier,
    // 3pts, for both games = 6+6=... ) would never land on this exact number.
    expect(capturedUpsert).toMatchObject({ games_played: 2, sacks: 5, def_int: 1, def_td: 0, fantasy_points: 27 });
  });
});
