import { describe, expect, it } from "vitest";
import { selectCvcStandingsMatchup } from "./cvcStandingsMatchup";

const rows = [
  { id: "week-1-a", week: { week_number: 1 }, away_franchise_id: "xavier", home_franchise_id: "heiden", result_state: "upcoming" },
  { id: "week-1-b", week: { week_number: 1 }, away_franchise_id: "wart-eaters", home_franchise_id: "legends", result_state: "upcoming" },
  { id: "week-2-a", week: { week_number: 2 }, away_franchise_id: "xavier", home_franchise_id: "legends", result_state: "upcoming" },
];

describe("selectCvcStandingsMatchup", () => {
  it("returns the signed-in franchise's Week 1 matchup when one exists", () => {
    const selection = selectCvcStandingsMatchup(rows, "wart-eaters");
    expect(selection.matchup?.id).toBe("week-1-b");
    expect(selection.isPersonal).toBe(true);
  });

  it("uses the neutral Week 1 fallback for a public visitor", () => {
    const selection = selectCvcStandingsMatchup(rows);
    expect(selection.matchup?.id).toBe("week-1-a");
    expect(selection.isPersonal).toBe(false);
  });

  it("falls back to the next unfinished CVC matchup when Week 1 is absent", () => {
    const selection = selectCvcStandingsMatchup([{ id: "final", result_state: "final" }, { id: "next", result_state: "upcoming" }]);
    expect(selection.matchup?.id).toBe("next");
  });
});
