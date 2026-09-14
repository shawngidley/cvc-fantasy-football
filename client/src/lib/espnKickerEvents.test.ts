import { describe, expect, it } from "vitest";
import { countMadeExtraPoints, formatKickerEvent, getKickerEventsForPlayer, groupKickerEventsForDisplay, parseEspnKickerEvents, sumMadeFieldGoalYards } from "./espnKickerEvents";

describe("ESPN kicker play parsing (ported from WRC's proven example)", () => {
  const summary = {
    drives: {
      previous: [{ plays: [
        { type: { text: "Field Goal Good" }, text: "B.Aubrey 54 yard field goal is GOOD, Center-T.Sieg." },
        { type: { text: "Field Goal Missed" }, text: "B.Aubrey 47 yard field goal is No Good." },
        { type: { text: "Extra Point Good" }, text: "B.Aubrey extra point is GOOD." },
      ] }],
    },
  };

  it("parses exact field-goal yards and matches an abbreviated ESPN kicker name", () => {
    const events = getKickerEventsForPlayer(parseEspnKickerEvents(summary), "Brandon Aubrey");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "fg", outcome: "made", yards: 54 });
    expect(events[1]).toMatchObject({ type: "fg", outcome: "missed", yards: 47 });
    expect(events[2]).toMatchObject({ type: "xp", outcome: "made" });
  });

  it("sums only made field-goal yards, excluding the missed attempt -- this is the exact value that replaces CVC's Kicking.fgYds so its own field_goal_yard scoring rule computes correctly", () => {
    const events = getKickerEventsForPlayer(parseEspnKickerEvents(summary), "Brandon Aubrey");
    expect(sumMadeFieldGoalYards(events)).toBe(54); // the 47-yard miss is excluded
  });

  it("counts made extra points", () => {
    const events = getKickerEventsForPlayer(parseEspnKickerEvents(summary), "Brandon Aubrey");
    expect(countMadeExtraPoints(events)).toBe(1);
  });

  it("returns 0 for a kicker with no matching events", () => {
    expect(sumMadeFieldGoalYards([])).toBe(0);
    expect(countMadeExtraPoints([])).toBe(0);
  });

  it("formats individual kick events without a point value (unlike WRC's version, since CVC's actual point value depends on CVC's own configured rules, not something this parsing module should assume)", () => {
    const events = getKickerEventsForPlayer(parseEspnKickerEvents(summary), "Brandon Aubrey");
    expect(events.map(formatKickerEvent)).toEqual(["54 yd FG made", "47 yd FG missed", "XP made"]);
  });

  it("combines multiple made FGs into one chip -- the real confirmed C. Little (JAX) case: 47 and 40 yard FGs made, previously shown as two separate chips", () => {
    const cLittleEvents: ReturnType<typeof getKickerEventsForPlayer> = [
      { playerName: "C. Little", type: "fg", outcome: "made", yards: 47, text: "C.Little 47 Yd Field Goal" },
      { playerName: "C. Little", type: "fg", outcome: "made", yards: 40, text: "C.Little 40 Yd Field Goal" },
    ];
    const chips = groupKickerEventsForDisplay(cLittleEvents);
    expect(chips).toHaveLength(1);
    expect(chips[0].text).toBe("47, 40 yd FG made");
    expect(chips[0].outcome).toBe("made");
  });

  it("keeps a missed FG and an XP as separate, individual chips, not combined with the made-FG chip", () => {
    const events = getKickerEventsForPlayer(parseEspnKickerEvents(summary), "Brandon Aubrey");
    const chips = groupKickerEventsForDisplay(events);
    expect(chips).toEqual([
      { key: expect.stringContaining("47"), text: "47 yd FG missed", outcome: "missed" },
      { key: expect.stringContaining("extra point"), text: "XP made", outcome: "made" },
      { key: "made-fgs-combined", text: "54 yd FG made", outcome: "made" },
    ]);
  });

  it("returns an empty array when there are no events at all", () => {
    expect(groupKickerEventsForDisplay([])).toEqual([]);
  });
});
