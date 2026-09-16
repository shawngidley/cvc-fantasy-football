import { describe, expect, it } from "vitest";
import { selectCvcStandingsMatchup } from "./cvcStandingsMatchup";

const rows = [
  { id: "week-1-a", week: { week_number: 1 }, away_franchise_id: "xavier", home_franchise_id: "heiden", result_state: "final" },
  { id: "week-1-b", week: { week_number: 1 }, away_franchise_id: "wart-eaters", home_franchise_id: "legends", result_state: "final" },
  { id: "week-2-a", week: { week_number: 2 }, away_franchise_id: "xavier", home_franchise_id: "legends", result_state: "upcoming" },
  { id: "week-2-b", week: { week_number: 2 }, away_franchise_id: "wart-eaters", home_franchise_id: "heiden", result_state: "upcoming" },
];

describe("selectCvcStandingsMatchup (fix for a real bug: this was hardcoded to week_number === 1, so it stayed stuck on Week 1's by-then-final matchup for the rest of the season regardless of what the actual current week was)", () => {
  it("returns the signed-in franchise's CURRENT week matchup, not Week 1's, once the season has moved past Week 1", () => {
    const selection = selectCvcStandingsMatchup(rows, "wart-eaters", 2);
    expect(selection.matchup?.id).toBe("week-2-b");
    expect(selection.isPersonal).toBe(true);
  });

  it("uses the neutral current-week fallback for a public visitor", () => {
    const selection = selectCvcStandingsMatchup(rows, undefined, 2);
    expect(selection.matchup?.id).toBe("week-2-a");
    expect(selection.isPersonal).toBe(false);
  });

  it("still correctly shows Week 1 when Week 1 genuinely is the current week", () => {
    const selection = selectCvcStandingsMatchup(rows, "wart-eaters", 1);
    expect(selection.matchup?.id).toBe("week-1-b");
    expect(selection.isPersonal).toBe(true);
  });

  it("falls back to the next unfinished CVC matchup when no currentWeekNumber is available at all", () => {
    const selection = selectCvcStandingsMatchup([{ id: "final", result_state: "final" }, { id: "next", result_state: "upcoming" }], undefined, null);
    expect(selection.matchup?.id).toBe("next");
  });

  it("falls back to the next unfinished matchup when the current week number doesn't match any matchup", () => {
    const selection = selectCvcStandingsMatchup(rows, "wart-eaters", 5);
    expect(selection.matchup?.id).toBe("week-2-a"); // first non-final matchup overall
  });
});
