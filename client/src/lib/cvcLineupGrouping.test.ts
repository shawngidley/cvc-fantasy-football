import { describe, expect, it } from "vitest";
import { groupCvcLineup, isCvcBenchAssignment, normalizeCvcPosition, type CvcLineupAssignment } from "./cvcLineupGrouping";

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

  it("orders offense as QB, RB, RB, WR, WR, TE and treats KI as K", () => {
    const group = groupCvcLineup([
      { id: "te", assigned_slot_code: "TE", player: { id: "te", display_name: "Tight End", position: "TE", nfl_team: "TEN" } },
      { id: "wr2", assigned_slot_code: "WR2", player: { id: "wr2", display_name: "Wide Two", position: "WR", nfl_team: "LAR" } },
      { id: "rb2", assigned_slot_code: "RB2", player: { id: "rb2", display_name: "Runner Two", position: "RB", nfl_team: "ATL" } },
      { id: "qb", assigned_slot_code: "QB", player: { id: "qb", display_name: "Quarterback", position: "QB", nfl_team: "BUF" } },
      { id: "wr1", assigned_slot_code: "WR1", player: { id: "wr1", display_name: "Wide One", position: "WR", nfl_team: "KC" } },
      { id: "rb1", assigned_slot_code: "RB1", player: { id: "rb1", display_name: "Runner One", position: "RB", nfl_team: "MIA" } },
      { id: "ki", assigned_slot_code: "K", player: { id: "ki", display_name: "Kicker", position: "KI", nfl_team: "DAL" } },
      { id: "bench-wr", assigned_slot_code: "BN", player: { id: "bench-wr", display_name: "Bench Wide", position: "WR", nfl_team: "NYG" } },
      { id: "bench-qb", assigned_slot_code: "BN", player: { id: "bench-qb", display_name: "Bench Quarterback", position: "QB", nfl_team: "CHI" } },
    ]);
    expect(group[0]?.starters.map(row => row.player?.display_name)).toEqual(["Quarterback", "Runner One", "Runner Two", "Wide One", "Wide Two", "Tight End"]);
    expect(group[0]?.bench.map(row => row.player?.display_name)).toEqual(["Bench Quarterback", "Bench Wide"]);
    expect(group[1]?.starters.map(row => row.player?.display_name)).toEqual(["Kicker"]);
    expect(normalizeCvcPosition("KI")).toBe("K");
    expect(normalizeCvcPosition("DE")).toBe("DST");
  });
});
