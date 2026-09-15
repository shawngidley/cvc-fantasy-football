import { describe, expect, it } from "vitest";
import { headToHeadDelta, type CvcFinalMatchup } from "./cvcStandings";

describe("headToHeadDelta (finalization audit item 10: CVC's documented standings rule requires head-to-head as the first tiebreaker, but the code previously jumped straight from wins/losses to points scored, skipping it entirely -- confirmed against docs/CVC_2026_Rules_and_Protection_Findings.md, the direct transcription of the commissioner's own rules workbook)", () => {
  it("credits the franchise that won their single head-to-head matchup", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "a", away_franchise_id: "b", home_score: 120, away_score: 100 },
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(1);
    expect(headToHeadDelta("b", "a", matchups)).toBe(-1);
  });

  it("sums across multiple head-to-head matchups between the same two franchises (e.g. a rematch in the playoffs)", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "a", away_franchise_id: "b", home_score: 120, away_score: 100 }, // a wins
      { home_franchise_id: "b", away_franchise_id: "a", home_score: 90, away_score: 110 }, // a wins again (a is away here)
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(2);
  });

  it("returns 0 for two franchises who split their head-to-head games evenly", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "a", away_franchise_id: "b", home_score: 120, away_score: 100 }, // a wins
      { home_franchise_id: "b", away_franchise_id: "a", home_score: 130, away_score: 100 }, // b wins
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(0);
  });

  it("returns 0 for two franchises who never played each other this season", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "c", away_franchise_id: "d", home_score: 120, away_score: 100 },
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(0);
  });

  it("ignores matchups between other franchises entirely (only counts direct games between the two given IDs)", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "a", away_franchise_id: "c", home_score: 200, away_score: 50 }, // irrelevant
      { home_franchise_id: "a", away_franchise_id: "b", home_score: 100, away_score: 120 }, // b wins
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(-1);
  });

  it("treats an exactly-tied head-to-head matchup as breaking nothing", () => {
    const matchups: CvcFinalMatchup[] = [
      { home_franchise_id: "a", away_franchise_id: "b", home_score: 100, away_score: 100 },
    ];
    expect(headToHeadDelta("a", "b", matchups)).toBe(0);
  });

  it("returns 0 for an empty matchup list", () => {
    expect(headToHeadDelta("a", "b", [])).toBe(0);
  });
});
