import { describe, expect, it } from "vitest";
import { applyEspnKickerOverrides } from "./tank01ScoringSync";
import type { Tank01LiveStats } from "@shared/cvcScoring";
import { calculateCvcFantasyPoints, type CvcScoringRule } from "@shared/cvcScoring";

// WRC lesson (Pineiro, Sept 2026): ESPN's extra point play text does not always match the
// parser, so an XP can be silently missing from the parsed events. Overriding Tank01's
// reliable Kicking.xpMade with a lower ESPN count then under-scores the kicker.
const kicker = (xpMade: number | string): Tank01LiveStats => ({ longName: "Eddy Pineiro", Kicking: { fgMade: 2, fgAttempts: 2, fgYds: 0, xpMade, xpAttempts: 3 } } as unknown as Tank01LiveStats);
const fg = (yards: number) => ({ playerName: "Eddy Pineiro", type: "fg" as const, outcome: "made" as const, yards, text: `E.Pineiro ${yards} yard field goal is GOOD` });
const xp = () => ({ playerName: "Eddy Pineiro", type: "xp" as const, outcome: "made" as const, yards: null, text: "E.Pineiro extra point is GOOD" });

const rules: CvcScoringRule[] = [
  { stat_key: "extra_point", value: 1, applies_to_positions: ["K"] },
  { stat_key: "field_goal_yard", value: 0.1, applies_to_positions: ["K"] },
] as unknown as CvcScoringRule[];

describe("applyEspnKickerOverrides: extra points", () => {
  it("keeps Tank01's XP count when ESPN parsed fewer XPs than Tank01 reports (one XP play text was not recognized)", () => {
    const statLines = new Map<string, Tank01LiveStats>([["eddypineiro", kicker(3)]]);
    applyEspnKickerOverrides(statLines, [fg(20), fg(56), xp(), xp()]);
    const kicking = (statLines.get("eddypineiro") as any).Kicking;
    expect(kicking.xpMade).toBe(3);
    expect(kicking.fgYds).toBe(76);
    expect(calculateCvcFantasyPoints(statLines.get("eddypineiro"), "K", rules)).toBe(10.6); // 76 yds * 0.1 + 3 XP
  });

  it("reads Tank01 XP counts that arrive as strings", () => {
    const statLines = new Map<string, Tank01LiveStats>([["eddypineiro", kicker("3")]]);
    applyEspnKickerOverrides(statLines, [fg(20), xp()]);
    expect(Number((statLines.get("eddypineiro") as any).Kicking.xpMade)).toBe(3);
  });

  it("still uses ESPN's XP count when it is higher than Tank01's (box score lagging behind play by play)", () => {
    const statLines = new Map<string, Tank01LiveStats>([["eddypineiro", kicker(1)]]);
    applyEspnKickerOverrides(statLines, [fg(40), xp(), xp()]);
    expect((statLines.get("eddypineiro") as any).Kicking.xpMade).toBe(2);
  });

  it("uses ESPN's XP count when Tank01 has no xpMade at all", () => {
    const entry = { longName: "Eddy Pineiro", Kicking: { fgMade: 1, fgAttempts: 1 } } as unknown as Tank01LiveStats;
    const statLines = new Map<string, Tank01LiveStats>([["eddypineiro", entry]]);
    applyEspnKickerOverrides(statLines, [fg(40), xp()]);
    expect((statLines.get("eddypineiro") as any).Kicking.xpMade).toBe(1);
  });
});
