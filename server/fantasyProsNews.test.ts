import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFantasyProsProjections, matchPlayerNameFromTitle } from "./fantasyProsNews";

describe("getFantasyProsProjections (using the real confirmed Matthew Stafford data)", () => {
  beforeEach(() => {
    process.env.FANTASYPROS_FEED_SECRET = "test-secret";
    vi.restoreAllMocks();
  });

  it("correctly parses points/pprPoints/passYards from row.stats -- the actual bug: row.stats is a plain object, not an array, so the previous asArray(row.stats)[0] silently produced an empty object for every player", async () => {
    // The WRC feed wraps the raw FantasyPros payload in a cache-row envelope
    // ({key, payload, fetched_at, expires_at}) -- the fields getFantasyProsProjections
    // actually parses live under `.payload`, not at the top level.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        key: "projections:QB:week:1",
        payload: {
          players: [{
            fpid: 9451, mflid: 9431, name: "Matthew Stafford", position_id: "QB", team_id: "LAR", filename: "matthew-stafford.php",
            stats: {
              points: 17.63, points_ppr: 17.63, points_half: 17.63, pass_att: 33.51, pass_cmp: 21.97,
              pass_yds: 251.57, pass_tds: 2, pass_ints: 0.53, pass_yds_300: 0, pass_yds_400: 0,
              rush_att: 1.39, rush_yds: 2.55, rush_tds: 0.02, rush_yds_100: 0, rush_yds_200: 0,
              scrimage_yards_100: 0, scrimage_yards_200: 0, fumbles: 0.15, ret_tds: 0, "2pt_tds": 0.1,
            },
          }],
        },
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

describe("matchPlayerNameFromTitle (using the exact real confirmed FantasyPros news titles)", () => {
  const candidatesLongestFirst = [{ display_name: "De'Zhaun Stribling" }, { display_name: "D'Andre Swift" }, { display_name: "AJ Brown" }, { display_name: "Josh Allen" }]
    .sort((a, b) => b.display_name.length - a.display_name.length);

  it("matches a parenthetical-injury-style title -- the actual bug: the raw response has no player_name/name field at all, so lookup by name never worked even though the name is right there in the title", () => {
    const match = matchPlayerNameFromTitle("De'Zhaun Stribling (ankle) out at least one month", candidatesLongestFirst);
    expect(match?.display_name).toBe("De'Zhaun Stribling");
  });

  it("matches a non-parenthetical, plain-sentence-style title", () => {
    const match = matchPlayerNameFromTitle("D'Andre Swift agrees to three-year extension with Bears", candidatesLongestFirst);
    expect(match?.display_name).toBe("D'Andre Swift");
  });

  it("matches despite a period-punctuation mismatch -- title says 'A.J. Brown', CVC's own record stores 'AJ Brown'", () => {
    const match = matchPlayerNameFromTitle("A.J. Brown (ankle) out at least six weeks", candidatesLongestFirst);
    expect(match?.display_name).toBe("AJ Brown");
  });

  it("does not false-positive-match a short prefix (e.g. 'Josh' alone shouldn't match 'Josh Allen' if the title is really about someone else)", () => {
    const match = matchPlayerNameFromTitle("Joshua Palmer (hamstring) questionable for Sunday", candidatesLongestFirst);
    expect(match).toBeUndefined();
  });

  it("returns undefined for a title matching no known player", () => {
    const match = matchPlayerNameFromTitle("Some Unrelated Person signs with a team", candidatesLongestFirst);
    expect(match).toBeUndefined();
  });
});
