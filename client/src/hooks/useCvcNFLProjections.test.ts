import { describe, expect, it } from "vitest";
import { getCvcProjectedPoints, type CvcProjectionMap } from "./useCvcNFLProjections";
import type { CvcScoringRule } from "@shared/cvcScoring";

// CVC's own configured rule set, not WRC's -- includes a reception bonus
// (applies_to_positions: ["TE"] only) specifically because that's the exact rule this
// fix protects: a TE's projected points must actually reflect this bonus regardless of
// whatever (possibly empty/unreliable) position string Tank01's projections endpoint
// itself reported for that row.
const rules: CvcScoringRule[] = [
  { stat_key: "receiving_yards", value: 0.1, applies_to_positions: ["RB", "WR", "TE"] },
  { stat_key: "reception", value: 0.5, applies_to_positions: ["TE"] },
];

describe("getCvcProjectedPoints (finalization audit item 5: position-dependent scoring must use the roster's own known position, not Tank01's own row.pos, which can come back empty)", () => {
  it("applies a TE's reception bonus using the caller-supplied position, even when the stored entry's own pos field disagrees", () => {
    const projections: CvcProjectionMap = {
      "sam smith": { stats: { Receiving: { recYds: 40, receptions: 4 } }, pos: "", team: "KC" }, // Tank01's own pos came back empty for this row
    };
    const points = getCvcProjectedPoints(projections, "Sam Smith", "TE", "KC", rules);
    // 40 * 0.1 (yards) + 4 * 0.5 (TE reception bonus) = 6.0
    expect(points).toBe(6);
  });

  it("does not apply the TE-only reception bonus for a WR with the same raw stat line", () => {
    const projections: CvcProjectionMap = {
      "sam smith": { stats: { Receiving: { recYds: 40, receptions: 4 } }, pos: "", team: "KC" },
    };
    const points = getCvcProjectedPoints(projections, "Sam Smith", "WR", "KC", rules);
    // 40 * 0.1 (yards) only -- no reception bonus, since the rule is TE-only and the
    // caller says this player is a WR.
    expect(points).toBe(4);
  });

  it("falls back to the provider's own pos only when the caller has no position at all", () => {
    const projections: CvcProjectionMap = {
      "sam smith": { stats: { Receiving: { recYds: 40, receptions: 4 } }, pos: "TE", team: "KC" },
    };
    const points = getCvcProjectedPoints(projections, "Sam Smith", null, "KC", rules);
    expect(points).toBe(6); // uses the entry's own "TE" since no caller position was given
  });

  it("returns null for a player with no projection entry at all", () => {
    expect(getCvcProjectedPoints({}, "Nobody Here", "WR", "KC", rules)).toBeNull();
  });

  it("looks up a DST by team code rather than by name, regardless of what display name is passed", () => {
    const projections: CvcProjectionMap = {
      "dst:SEA": { stats: { Defense: { sacks: 3, defensiveInterceptions: 1 } }, pos: "DST", team: "SEA" },
    };
    const rulesWithDst: CvcScoringRule[] = [
      { stat_key: "sack", value: 2, applies_to_positions: ["DST"] },
      { stat_key: "defensive_interception", value: 3, applies_to_positions: ["DST"] },
    ];
    const points = getCvcProjectedPoints(projections, "Anything At All", "DST", "SEA", rulesWithDst);
    expect(points).toBe(9); // 3 sacks * 2 + 1 int * 3
  });

  it("treats DEF the same as DST for position resolution", () => {
    const projections: CvcProjectionMap = {
      "dst:SEA": { stats: { Defense: { sacks: 3, defensiveInterceptions: 1 } }, pos: "DST", team: "SEA" },
    };
    const rulesWithDst: CvcScoringRule[] = [{ stat_key: "sack", value: 2, applies_to_positions: ["DST"] }];
    expect(getCvcProjectedPoints(projections, "Anything", "DEF", "SEA", rulesWithDst)).toBe(6);
  });
});
