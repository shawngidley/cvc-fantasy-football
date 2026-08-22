import { describe, expect, it } from "vitest";
import { calculateCvcFantasyPoints, type CvcScoringRule } from "../shared/cvcScoring";

const rules: CvcScoringRule[] = [
  { stat_key: "passing_yards", value: 0.05, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "passing_touchdown", value: 4, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "interception", value: -1, applies_to_positions: ["QB"] },
  { stat_key: "rushing_yards", value: 0.1, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "rushing_touchdown", value: 6, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "receiving_yards", value: 0.1, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "receiving_touchdown", value: 6, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "reception", value: 0.5, applies_to_positions: ["RB", "WR", "TE"] },
  { stat_key: "extra_point", value: 1, applies_to_positions: ["K"] },
  { stat_key: "field_goal_yard", value: 0.1, applies_to_positions: ["K"] },
  { stat_key: "fumble_recovery", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_interception", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "sack", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_touchdown", value: 6, applies_to_positions: ["DST"] },
  { stat_key: "safety", value: 5, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_0", value: 15, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_1_6", value: 10, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_7_13", value: 5, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_14_20", value: 3, applies_to_positions: ["DST"] },
];

describe("CVC scoring engine", () => {
  it("scores the supplied quarterback rules", () => {
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 200, passTD: 1, int: 1 }, Rushing: { rushYds: 20 } }, "QB", rules)).toBe(15);
  });
  it("scores skill-position passing, rushing, receiving, and half-PPR rules", () => {
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 40 }, Rushing: { rushYds: 30, rushTD: 1 }, Receiving: { receptions: 5, recYds: 20, recTD: 1 } }, "RB", rules)).toBe(21.5);
  });
  it("scores kicker extra points and made field-goal yardage", () => {
    expect(calculateCvcFantasyPoints({ Kicking: { xpMade: 2, fgYds: 85 } }, "K", rules)).toBe(10.5);
  });
  it("scores D/ST events and the supplied points-allowed tier", () => {
    expect(calculateCvcFantasyPoints({ Defense: { sacks: 3, defensiveInterceptions: 1, fumblesRecovered: 1, defensiveOrSpecialTeamsTds: 1, safeties: 1, ptsAgainst: 7 } }, "DST", rules)).toBe(26);
  });
});
