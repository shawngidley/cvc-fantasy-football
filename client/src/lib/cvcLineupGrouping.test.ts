import { describe, expect, it } from "vitest";
import { groupCvcLineup, isCvcBenchAssignment, type CvcLineupAssignment } from "./cvcLineupGrouping";

const rows: CvcLineupAssignment[] = [
  { id: "qb", assigned_slot_code: "QB", player: { id: "p1", display_name: "Quarterback", position: "QB", nfl_team: "BUF" } },
  { id: "bench-rb", assigned_slot_code: "BN", player: { id: "p2", display_name: "Runner", position: "RB", nfl_team: "ATL" } },
  { id: "k", assigned_slot_code: "K", player: { id: "p3", display_name: "Kicker", position: "K", nfl_team: "KC" } },
  { id: "def", assigned_slot_code: null, player: { id: "p4", display_name: "Defense", position: "DST", nfl_team: "PIT" } },
];

describe("CVC lineup grouping", () => {
  it("distinguishes assigned starter slots from bench-style slots", () => {
    expect(isCvcBenchAssignment(rows[0])).toBe(false);
    expect(isCvcBenchAssignment(rows[1])).toBe(true);
    expect(isCvcBenchAssignment(rows[3])).toBe(true);
  });

  it("keeps Offense, Kicker, and D/ST sections separate with bench players beneath starters", () => {
    const groups = groupCvcLineup(rows);
    expect(groups.map(group => group.key)).toEqual(["OFFENSE", "K", "DST"]);
    expect(groups[0].starters.map(row => row.player?.display_name)).toEqual(["Quarterback"]);
    expect(groups[0].bench.map(row => row.player?.display_name)).toEqual(["Runner"]);
    expect(groups[1].starters).toHaveLength(1);
    expect(groups[2].bench).toHaveLength(1);
  });
});
