import { describe, expect, it } from "vitest";
import { aggregateWeeklyStatsForSeason, extractWeeklyStatRow, type CvcWeeklyStatRow } from "./cvcPlayerWeeklyStats";
import type { CvcScoringRule } from "@shared/cvcScoring";

const rules: CvcScoringRule[] = [
  { stat_key: "passing_yards", value: 0.04, applies_to_positions: ["QB"] },
  { stat_key: "passing_touchdown", value: 4, applies_to_positions: ["QB"] },
];

describe("extractWeeklyStatRow", () => {
  it("marks games_played 0 and leaves every stat field null when there's no stat line at all (bye, injury, inactive)", () => {
    const row = extractWeeklyStatRow(null, "QB", rules);
    expect(row.games_played).toBe(0);
    expect(row.pass_yds).toBeNull();
    expect(row.fantasy_points).toBe(0);
  });

  it("marks games_played 1 when a real stat line exists, even if every stat in it is zero", () => {
    const row = extractWeeklyStatRow({ Passing: { passYds: 0, passTD: 0 } }, "QB", rules);
    expect(row.games_played).toBe(1);
    expect(row.pass_yds).toBe(0);
  });

  it("extracts real stats and computes fantasy points using CVC's own scoring rules", () => {
    const row = extractWeeklyStatRow({ Passing: { passYds: 300, passTD: 2 } }, "QB", rules);
    expect(row.pass_yds).toBe(300);
    expect(row.pass_td).toBe(2);
    expect(row.fantasy_points).toBe(300 * 0.04 + 2 * 4);
  });
});

describe("aggregateWeeklyStatsForSeason (the exact behaviors flagged as easy to get subtly wrong)", () => {
  const week = (overrides: Partial<CvcWeeklyStatRow>): CvcWeeklyStatRow => ({
    games_played: 1,
    pass_yds: null, pass_td: null, pass_int: null,
    rush_att: null, rush_yds: null, rush_td: null,
    targets: null, receptions: null, rec_yds: null, rec_td: null,
    fg_made: null, xp_made: null,
    sacks: null, def_int: null, def_td: null,
    fantasy_points: 0,
    ...overrides,
  });

  it("sums a simple stat field across multiple weeks", () => {
    const rows = [week({ pass_yds: 250 }), week({ pass_yds: 300 }), week({ pass_yds: 180 })];
    expect(aggregateWeeklyStatsForSeason(rows).pass_yds).toBe(730);
  });

  it("sums fantasy points across weeks, rounded to 2 decimal places", () => {
    const rows = [week({ fantasy_points: 12.345 }), week({ fantasy_points: 8.11 })];
    expect(aggregateWeeklyStatsForSeason(rows).fantasy_points).toBe(20.46); // 12.345 + 8.11 = 20.455, rounds to 20.46 (banker's rounding aside, matches Math.round behavior)
  });

  it("games_played sums each week's explicit 0/1 flag, not the number of rows", () => {
    // 3 rows total (3 weeks passed), but only 2 of them had an actual stat line --
    // the third is a bye week (games_played: 0, still a real row).
    const rows = [week({ games_played: 1 }), week({ games_played: 0 }), week({ games_played: 1 })];
    expect(aggregateWeeklyStatsForSeason(rows).games_played).toBe(2);
  });

  it("fantasy_points_per_game divides by games_played, NOT by the number of rows passed in -- the exact bug this test exists to lock down", () => {
    // 4 rows (4 weeks of the season so far), but only 2 were actually played (the other
    // 2 are a bye week and an injury week, both games_played: 0, 0 fantasy points).
    // Dividing by row count (4) would wrongly deflate this to 5.0; dividing by the
    // real games played (2) correctly gives 10.0.
    const rows = [
      week({ games_played: 1, fantasy_points: 12 }),
      week({ games_played: 0, fantasy_points: 0 }), // bye week
      week({ games_played: 1, fantasy_points: 8 }),
      week({ games_played: 0, fantasy_points: 0 }), // injury week, inactive
    ];
    const result = aggregateWeeklyStatsForSeason(rows);
    expect(result.games_played).toBe(2);
    expect(result.fantasy_points).toBe(20);
    expect(result.fantasy_points_per_game).toBe(10); // 20 / 2, not 20 / 4
  });

  it("fantasy_points_per_game is null (not 0 or NaN) when no games have been played yet at all", () => {
    const rows = [week({ games_played: 0 }), week({ games_played: 0 })];
    expect(aggregateWeeklyStatsForSeason(rows).fantasy_points_per_game).toBeNull();
  });

  it("a stat field stays null for the season when every week's row has it null (never attempted that category), not 0", () => {
    const rows = [week({}), week({})];
    expect(aggregateWeeklyStatsForSeason(rows).rush_yds).toBeNull();
  });

  it("a stat field sums correctly even when some weeks have it null and others have a real value (e.g. a QB who ran the ball in some weeks but not others)", () => {
    const rows = [week({ rush_yds: 20 }), week({ rush_yds: null }), week({ rush_yds: 15 })];
    expect(aggregateWeeklyStatsForSeason(rows).rush_yds).toBe(35);
  });

  it("returns all-null/zero for an empty list of weekly rows (a player with no finalized weeks yet)", () => {
    const result = aggregateWeeklyStatsForSeason([]);
    expect(result.games_played).toBe(0);
    expect(result.fantasy_points).toBe(0);
    expect(result.fantasy_points_per_game).toBeNull();
    expect(result.pass_yds).toBeNull();
  });
});
