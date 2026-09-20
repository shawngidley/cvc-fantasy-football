import { describe, expect, it } from "vitest";
import { calculateCvcFantasyPoints, calculateCvcFantasyPointsBreakdown, type CvcScoringRule } from "../shared/cvcScoring";

const rules: CvcScoringRule[] = [
  { stat_key: "passing_yards", value: 0.05, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "passing_touchdown", value: 4, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "interception", value: -1, applies_to_positions: ["QB"] },
  { stat_key: "rushing_yards", value: 0.1, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "rushing_touchdown", value: 6, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "receiving_yards", value: 0.1, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "receiving_touchdown", value: 6, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "reception", value: 0.5, applies_to_positions: ["RB", "WR", "TE"] },
  { stat_key: "passing_300_bonus", value: 5, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "rushing_100_bonus", value: 5, applies_to_positions: ["QB", "RB", "WR", "TE"] },
  { stat_key: "receiving_100_bonus", value: 5, applies_to_positions: ["QB", "RB", "WR", "TE"] },
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

  it("awards the +5 bonus for exactly 100 rushing yards, but not for 99", () => {
    expect(calculateCvcFantasyPoints({ Rushing: { rushYds: 100 } }, "RB", rules)).toBe(100 * 0.1 + 5);
    expect(calculateCvcFantasyPoints({ Rushing: { rushYds: 99 } }, "RB", rules)).toBe(99 * 0.1);
  });

  it("awards the +5 bonus for exactly 100 receiving yards, but not for 99", () => {
    expect(calculateCvcFantasyPoints({ Receiving: { recYds: 100 } }, "WR", rules)).toBe(100 * 0.1 + 5);
    expect(calculateCvcFantasyPoints({ Receiving: { recYds: 99 } }, "WR", rules)).toBe(99 * 0.1);
  });

  it("awards the +5 bonus for exactly 300 passing yards, but not for 299", () => {
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 300 } }, "QB", rules)).toBe(300 * 0.05 + 5);
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 299 } }, "QB", rules)).toBe(14.95); // 299 * 0.05 rounded to 2 decimals, same as the function itself does -- raw 299 * 0.05 has a floating-point tail (14.950000000000001) that .toBe() won't match
  });

  // Regression guard: every other test here defines its own fixture, so renaming a
  // stat_key in both the fixture and the engine keeps them green while production --
  // whose scoring_rule rows this file never sees -- silently stops matching. That is
  // the exact bug that twice looked like a threshold or deploy problem, so pin the
  // behaviour rather than the name: either key must resolve the bonus.
  it("resolves the passing bonus under either stat_key, so a DB/code key mismatch cannot silently zero it", () => {
    const underOldKey = rules.map(rule => rule.stat_key === "passing_300_bonus" ? { ...rule, stat_key: "passing_350_bonus" } : rule);
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 324 } }, "QB", rules)).toBe(324 * 0.05 + 5);
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 324 } }, "QB", underOldKey)).toBe(324 * 0.05 + 5);
  });

  it("drops the bonus only when no bonus rule exists at all, never because of the key name", () => {
    const withNoBonusRule = rules.filter(rule => rule.stat_key !== "passing_300_bonus");
    expect(calculateCvcFantasyPoints({ Passing: { passYds: 324 } }, "QB", withNoBonusRule)).toBe(324 * 0.05);
  });

  it("can award multiple bonuses at once for a dual-threat stat line (e.g. 300+ passing and 100+ rushing in the same game)", () => {
    const points = calculateCvcFantasyPoints({ Passing: { passYds: 380 }, Rushing: { rushYds: 110 } }, "QB", rules);
    expect(points).toBe(380 * 0.05 + 5 + 110 * 0.1 + 5);
  });
});

describe("calculateCvcFantasyPointsBreakdown (powers the points-breakdown popup)", () => {
  it("sums to exactly the same total as calculateCvcFantasyPoints, for a QB with a bonus", () => {
    const stats = { Passing: { passYds: 380, passTD: 3, int: 1 }, Rushing: { rushYds: 20 } };
    const total = calculateCvcFantasyPoints(stats, "QB", rules);
    const breakdown = calculateCvcFantasyPointsBreakdown(stats, "QB", rules);
    const breakdownTotal = Math.round(breakdown.reduce((sum, item) => sum + item.points, 0) * 100) / 100;
    expect(breakdownTotal).toBe(total);
  });

  it("omits stats that didn't happen (zero value), same convention as the DST live-scoring chips", () => {
    const breakdown = calculateCvcFantasyPointsBreakdown({ Passing: { passYds: 250, passTD: 2, int: 0 } }, "QB", rules);
    expect(breakdown.some(item => item.label.includes("INT"))).toBe(false);
    expect(breakdown.some(item => item.label.includes("rushing"))).toBe(false);
  });

  it("includes a labeled bonus line item separately from the base yardage line item", () => {
    const breakdown = calculateCvcFantasyPointsBreakdown({ Passing: { passYds: 380 } }, "QB", rules);
    expect(breakdown).toContainEqual({ label: "380 passing yds", points: 380 * 0.05 });
    expect(breakdown).toContainEqual({ label: "300+ passing yd bonus", points: 5 });
  });

  it("breaks down the real confirmed Jacksonville DST line from Week 1 CLE@JAX correctly", () => {
    const jaxDefense = { defensiveInterceptions: 1, sacks: 5, fumblesRecovered: 1, ptsAllowed: 10, defTD: 0, safeties: 0 };
    const breakdown = calculateCvcFantasyPointsBreakdown({ Defense: jaxDefense }, "DST", rules);
    expect(breakdown).toContainEqual({ label: "1 fumble recovery", points: 2 });
    expect(breakdown).toContainEqual({ label: "1 interception", points: 2 });
    expect(breakdown).toContainEqual({ label: "5 sacks", points: 10 });
    expect(breakdown).toContainEqual({ label: "10 points allowed (7-13)", points: 5 });
    // No defensive-TD or safety line items, since both are 0.
    expect(breakdown.some(item => item.label.includes("defensive TD"))).toBe(false);
    expect(breakdown.some(item => item.label.includes("safet"))).toBe(false);
  });

  it("returns an empty list for a completely blank stat line", () => {
    expect(calculateCvcFantasyPointsBreakdown({}, "QB", rules)).toEqual([]);
  });

  it("does not crash when stats itself is null or undefined (e.g. a stale cache with an incompatible shape) -- returns an empty breakdown instead of throwing on stats.Passing", () => {
    expect(calculateCvcFantasyPointsBreakdown(null, "QB", rules)).toEqual([]);
    expect(calculateCvcFantasyPointsBreakdown(undefined, "QB", rules)).toEqual([]);
    expect(calculateCvcFantasyPoints(null, "QB", rules)).toBe(0);
    expect(calculateCvcFantasyPoints(undefined, "QB", rules)).toBe(0);
  });
});
