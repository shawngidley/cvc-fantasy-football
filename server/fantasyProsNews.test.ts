import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFantasyProsProjections } from "./fantasyProsNews";

describe("getFantasyProsProjections (using the real confirmed Matthew Stafford data)", () => {
  beforeEach(() => {
    process.env.FANTASYPROS_API_KEY = "test-key";
    vi.restoreAllMocks();
  });

  it("correctly parses points/pprPoints/passYards from row.stats -- the actual bug: row.stats is a plain object, not an array, so the previous asArray(row.stats)[0] silently produced an empty object for every player", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [{
          fpid: 9451, mflid: 9431, name: "Matthew Stafford", position_id: "QB", team_id: "LAR", filename: "matthew-stafford.php",
          stats: {
            points: 17.63, points_ppr: 17.63, points_half: 17.63, pass_att: 33.51, pass_cmp: 21.97,
            pass_yds: 251.57, pass_tds: 2, pass_ints: 0.53, pass_yds_300: 0, pass_yds_400: 0,
            rush_att: 1.39, rush_yds: 2.55, rush_tds: 0.02, rush_yds_100: 0, rush_yds_200: 0,
            scrimage_yards_100: 0, scrimage_yards_200: 0, fumbles: 0.15, ret_tds: 0, "2pt_tds": 0.1,
          },
        }],
      }),
    } as any);

    const projections = await getFantasyProsProjections(2026, "QB", 1);
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      name: "Matthew Stafford",
      points: 17.63,
      pprPoints: 17.63,
      passYards: 251.57,
      passTouchdowns: 2,
      interceptions: 0.53,
      rushYards: 2.55,
      rushTouchdowns: 0.02,
    });
  });
});
