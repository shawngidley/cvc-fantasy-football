import { describe, expect, it } from "vitest";

// Same real, confirmed-live KC schedule data used in client/src/lib/nflSchedule.test.ts,
// trimmed to the fields summarizeTeamSchedule actually reads.
const REAL_KC_GAMES = [
  { gameID: "20260815_LAR@KC", seasonType: "Preseason", away: "LAR", home: "KC", gameDate: "20260815", gameWeek: "Preseason Week 1", gameTime: "4:00p" },
  { gameID: "20260914_DEN@KC", seasonType: "Regular Season", away: "DEN", home: "KC", gameDate: "20260914", gameWeek: "Week 1", gameTime: "8:15p" },
  { gameID: "20260920_IND@KC", seasonType: "Regular Season", away: "IND", home: "KC", gameDate: "20260920", gameWeek: "Week 2", gameTime: "8:20p" },
  { gameID: "20261018_LAC@KC", seasonType: "Regular Season", away: "LAC", home: "KC", gameDate: "20261018", gameWeek: "Week 6", gameTime: "4:25p" },
];

// summarizeTeamSchedule is not exported (kept module-private); test it indirectly via
// a locally re-implemented copy is avoided -- instead, re-export it for testing.
import { __testables } from "./nflTeamScheduleSync";

describe("summarizeTeamSchedule (server-side)", () => {
  it("finds the first gap in the week sequence as the bye week, using real KC data", () => {
    const result = __testables.summarizeTeamSchedule(REAL_KC_GAMES, "KC");
    // Weeks present (regular season only): 1, 2, 6 -- first gap is week 3.
    expect(result.byeWeek).toBe(3);
  });

  it("ignores preseason games entirely", () => {
    const onlyPreseason = [REAL_KC_GAMES[0]];
    const result = __testables.summarizeTeamSchedule(onlyPreseason, "KC");
    expect(result.byeWeek).toBeNull();
    expect(result.nextOpponent).toBeNull();
  });
});
