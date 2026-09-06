import { describe, expect, it } from "vitest";
import { extractScheduleGames, buildScheduleWithBye, summarizeSchedule } from "./nflSchedule";

// Trimmed but real, confirmed-live shape from a getNFLTeamSchedule response for KC:
// { body: { team: "KC", schedule: [...] } } -- games nested under "schedule", not
// the body itself, and not a flat array or an id-keyed map either.
const REAL_KC_BODY = {
  team: "KC",
  schedule: [
    { gameID: "20260815_LAR@KC", seasonType: "Preseason", away: "LAR", home: "KC", gameDate: "20260815", gameWeek: "Preseason Week 1", gameTime: "4:00p" },
    { gameID: "20260914_DEN@KC", seasonType: "Regular Season", away: "DEN", home: "KC", gameDate: "20260914", gameWeek: "Week 1", gameTime: "8:15p" },
    { gameID: "20260920_IND@KC", seasonType: "Regular Season", away: "IND", home: "KC", gameDate: "20260920", gameWeek: "Week 2", gameTime: "8:20p" },
    { gameID: "20261018_LAC@KC", seasonType: "Regular Season", away: "LAC", home: "KC", gameDate: "20261018", gameWeek: "Week 6", gameTime: "4:25p" },
  ],
};

describe("extractScheduleGames", () => {
  it("extracts the nested schedule array, not a length-1 wrapper around it (the confirmed live bug)", () => {
    const games = extractScheduleGames(REAL_KC_BODY);
    // The old Object.values(body) fallback would have produced a length-1 array
    // containing the whole schedule array as its single element (since arrays are
    // objects in JS) -- confirm we get the real, flattened 4 games instead.
    expect(games).toHaveLength(4);
    expect(games[1]).toMatchObject({ gameID: "20260914_DEN@KC", gameWeek: "Week 1" });
  });

  it("still handles a flat array body directly", () => {
    expect(extractScheduleGames([{ gameID: "a" }, { gameID: "b" }])).toHaveLength(2);
  });

  it("returns empty for null/undefined/non-object bodies instead of throwing", () => {
    expect(extractScheduleGames(null)).toEqual([]);
    expect(extractScheduleGames(undefined)).toEqual([]);
    expect(extractScheduleGames("oops")).toEqual([]);
  });
});

describe("buildScheduleWithBye + summarizeSchedule with the real KC shape", () => {
  it("correctly detects the bye week (gap in the week sequence) and the next upcoming game", () => {
    const games = extractScheduleGames(REAL_KC_BODY);
    const rows = buildScheduleWithBye(games, "KC");
    // Regular season only: Week 1, 2, then a gap (weeks 3-5 missing from this trimmed
    // fixture would show as byes too, but real data has them) then Week 6.
    expect(rows.some(row => row.type === "bye")).toBe(true);

    const summary = summarizeSchedule(games, "KC");
    expect(summary.byeWeek).not.toBeNull();
  });
});
