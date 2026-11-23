import { describe, expect, it } from "vitest";
import { applyReturnTouchdownsToDefense, isSpecialTeamsReturnTouchdown, parseEspnReturnTouchdowns } from "./espnReturnTouchdowns";
import { calculateCvcFantasyPoints } from "./cvcScoring";

const dstRules = [
  { stat_key: "sack", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_interception", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "fumble_recovery", value: 2, applies_to_positions: ["DST"] },
  { stat_key: "defensive_touchdown", value: 6, applies_to_positions: ["DST"] },
  { stat_key: "safety", value: 5, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_0", value: 15, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_1_6", value: 10, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_7_13", value: 5, applies_to_positions: ["DST"] },
  { stat_key: "points_allowed_14_20", value: 3, applies_to_positions: ["DST"] },
];

// CAR 35, BAL 33 on 2026-11-22, trimmed to the scoring plays that matter here.
const ravensAtPanthers = {
  scoringPlays: [
    { id: "4016001", type: { text: "Safety" }, text: "B.Young sacked at CAR End Zone for -8 yards (M.Green). SAFETY.", team: { abbreviation: "BAL" } },
    { id: "4016002", type: { text: "Passing Touchdown" }, text: "J.Brissett pass deep right complete to R.Bateman for 52 yards, TOUCHDOWN.", team: { abbreviation: "BAL" } },
    { id: "4016003", type: { text: "Rushing Touchdown" }, text: "C.Hubbard rushed left tackle for 18 yards, TOUCHDOWN.", team: { abbreviation: "CAR" } },
    { id: "4016004", type: { text: "Kickoff Return Touchdown" }, text: "R.Fitzgerald kicks 51 yards from CAR 35 to the BAL 14. D.Walker returns the kickoff for 86 yards, TOUCHDOWN.", team: { abbreviation: "BAL" } },
    { id: "4016005", type: { text: "Field Goal Good" }, text: "R.Fitzgerald 37 yard field goal is GOOD.", team: { abbreviation: "CAR" } },
  ],
};

describe("special-teams return touchdowns from an ESPN summary", () => {
  it("counts Devin Walker's kickoff return for Baltimore and nothing for Carolina", () => {
    const counts = parseEspnReturnTouchdowns(ravensAtPanthers);
    expect(counts.get("BAL")).toBe(1);
    expect(counts.has("CAR")).toBe(false);
  });

  it("counts punt returns and blocked kicks, and leaves interception and fumble returns to Tank01's defTD", () => {
    const plays = [
      { type: { text: "Punt Return Touchdown" }, team: { abbreviation: "KC" } },
      { type: { text: "Blocked Punt Touchdown" }, team: { abbreviation: "KC" } },
      { type: { text: "Blocked Field Goal Touchdown" }, team: { abbreviation: "KC" } },
      { type: { text: "Interception Return Touchdown" }, team: { abbreviation: "KC" } },
      { type: { text: "Fumble Return Touchdown" }, team: { abbreviation: "KC" } },
      { type: { text: "Kickoff Return Touchdown" }, team: { abbreviation: "DEN" } },
    ];
    expect(plays.map(isSpecialTeamsReturnTouchdown)).toEqual([true, true, true, false, false, true]);
    const counts = parseEspnReturnTouchdowns({ scoringPlays: plays });
    expect(counts.get("KC")).toBe(3);
    expect(counts.get("DEN")).toBe(1);
  });

  it("falls back to the play text when ESPN gives no type, and ignores a return that was not a touchdown", () => {
    expect(isSpecialTeamsReturnTouchdown({ text: "D.Walker returns the kickoff for 86 yards, TOUCHDOWN." })).toBe(true);
    expect(isSpecialTeamsReturnTouchdown({ text: "D.Walker returns the kickoff for 30 yards to the BAL 44." })).toBe(false);
  });

  it("adds the return TD on top of Tank01's defTD, and re-applying does not compound it", () => {
    const tank01 = { teamAbv: "BAL", defTD: "0", sacks: "3", defensiveInterceptions: "1", safeties: "1", fumblesRecovered: "0", ptsAllowed: "35" };
    const once = applyReturnTouchdownsToDefense(tank01, 1);
    const twice = applyReturnTouchdownsToDefense(once, 1);
    expect(once.defTD).toBe(1);
    expect(twice.defTD).toBe(1);
    expect(twice.defTDProvider).toBe(0);
  });

  it("keeps a defensive touchdown Tank01 already counted alongside the special-teams one", () => {
    const withPickSix = applyReturnTouchdownsToDefense({ defTD: "1" }, 1);
    expect(withPickSix.defTD).toBe(2);
  });

  it("scores the Ravens D/ST at 19, not 13: 3 sacks, 1 INT, 1 safety, 1 return TD, 35 allowed", () => {
    const tank01 = { teamAbv: "BAL", defTD: "0", sacks: "3", defensiveInterceptions: "1", safeties: "1", fumblesRecovered: "0", ptsAllowed: "35" };
    expect(calculateCvcFantasyPoints({ Defense: tank01 } as any, "DST", dstRules)).toBe(13);
    const corrected = applyReturnTouchdownsToDefense(tank01, parseEspnReturnTouchdowns(ravensAtPanthers).get("BAL") ?? 0);
    expect(calculateCvcFantasyPoints({ Defense: corrected } as any, "DST", dstRules)).toBe(19);
  });
});
