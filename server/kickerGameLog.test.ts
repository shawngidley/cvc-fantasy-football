import { describe, expect, it } from "vitest";
import type { CvcScoringRule } from "@shared/cvcScoring";
import type { KickerPlayEvent } from "@shared/espnKickerEvents";
import { applyEspnYardsToKickerGames, buildKickerSeasonRows, kickerGameKey } from "./kickerGameLog";
import type { CvcGameLogEntry } from "./playerCareerStats";

// Real shape from the Oct 22 2026 profile page: Chase McLaughlin's Tank01 game log has the right
// FGM/FGA/XPM but no FG yardage, so every row scored as extra points only (2 FG + 3 XP = 3.0).
const rules = [
  { stat_key: "extra_point", value: 1, applies_to_positions: ["K"] },
  { stat_key: "field_goal_yard", value: 0.1, applies_to_positions: ["K"] },
] as unknown as CvcScoringRule[];

const game = (gameId: string, fgMade: number, fgAtt: number, xpMade: number, cvcPts: number): CvcGameLogEntry =>
  ({ gameId, gameDate: gameId.split("_")[0], opponent: "CIN", isHome: false, fgMade, fgAtt, xpMade, xpAtt: xpMade, cvcPts });
const fg = (yards: number): KickerPlayEvent => ({ playerName: "Chase McLaughlin", type: "fg", outcome: "made", yards, text: `C.McLaughlin ${yards} yard field goal is GOOD` });
const miss = (yards: number): KickerPlayEvent => ({ playerName: "Chase McLaughlin", type: "fg", outcome: "missed", yards, text: `C.McLaughlin ${yards} yard field goal is No Good` });
const xp = (): KickerPlayEvent => ({ playerName: "Chase McLaughlin", type: "xp", outcome: "made", yards: null, text: "C.McLaughlin extra point is GOOD" });

describe("applyEspnYardsToKickerGames", () => {
  it("adds field goal yardage to a kicker's game points", () => {
    const games = [game("20260913_TB@CIN", 2, 2, 3, 3)];
    const events = new Map([[kickerGameKey("20260913", "CIN", "TB"), [fg(40), fg(48), xp(), xp(), xp()]]]);
    const [row] = applyEspnYardsToKickerGames(games, "Chase McLaughlin", rules, events);
    expect(row.cvcPts).toBe(11.8); // 88 yards * 0.1 + 3 XP
    expect(row.fgMade).toBe(2);
    expect(row.fgAtt).toBe(2);
    expect(row.xpMade).toBe(3);
  });

  it("does not count missed kicks as yardage", () => {
    const games = [game("20260920_TB@CLE", 1, 2, 1, 1)];
    const events = new Map([[kickerGameKey("20260920", "CLE", "TB"), [fg(30), miss(55), xp()]]]);
    expect(applyEspnYardsToKickerGames(games, "Chase McLaughlin", rules, events)[0].cvcPts).toBe(4);
  });

  it("keeps Tank01's extra point count when ESPN's play text missed one", () => {
    const games = [game("20260927_TB@MIN", 3, 3, 3, 3)];
    const events = new Map([[kickerGameKey("20260927", "MIN", "TB"), [fg(30), fg(30), fg(30), xp()]]]);
    expect(applyEspnYardsToKickerGames(games, "Chase McLaughlin", rules, events)[0].cvcPts).toBe(12); // 90 yards * 0.1 + 3 XP
  });

  it("leaves a game untouched when ESPN has nothing for it", () => {
    const games = [game("20261004_TB@GB", 0, 0, 2, 2)];
    const out = applyEspnYardsToKickerGames(games, "Chase McLaughlin", rules, new Map());
    expect(out[0]).toEqual(games[0]);
  });

  it("only uses events for this kicker, not the opposing kicker in the same game", () => {
    const games = [game("20261008_TB@DAL", 1, 1, 3, 3)];
    const other: KickerPlayEvent = { playerName: "Brandon Aubrey", type: "fg", outcome: "made", yards: 60, text: "B.Aubrey 60 yard field goal is GOOD" };
    const events = new Map([[kickerGameKey("20261008", "DAL", "TB"), [other, fg(35), xp(), xp(), xp()]]]);
    expect(applyEspnYardsToKickerGames(games, "Chase McLaughlin", rules, events)[0].cvcPts).toBe(6.5);
  });
});

describe("buildKickerSeasonRows", () => {
  it("sums a season from its game log rows so the Stats tab always agrees with the Game Log", () => {
    const rows = buildKickerSeasonRows({
      2026: [game("20260913_TB@CIN", 2, 2, 3, 11.8), game("20260920_TB@CLE", 4, 4, 1, 14)],
      2025: [game("20250907_TB@ATL", 1, 2, 2, 5)],
    }, "TB");
    expect(rows.map(r => r.season)).toEqual([2026, 2025]);
    expect(rows[0]).toMatchObject({ season: 2026, team: "TB", gp: 2, fgMade: 6, fgAtt: 6, fgPct: 100, xpMade: 4, xpAtt: 4, cvcPts: 25.8, cvcPtsPerGame: 12.9 });
    expect(rows[1]).toMatchObject({ season: 2025, gp: 1, fgMade: 1, fgAtt: 2, fgPct: 50, cvcPts: 5 });
  });

  it("omits a season with no games", () => {
    expect(buildKickerSeasonRows({ 2026: [], 2025: [game("20250907_TB@ATL", 1, 1, 1, 4)] }, "TB").map(r => r.season)).toEqual([2025]);
  });
});
