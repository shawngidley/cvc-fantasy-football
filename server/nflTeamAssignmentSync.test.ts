import { describe, expect, it } from "vitest";
import { latestTeamsFromRosterRows, rosterKey } from "./nflTeamAssignmentRules";

describe("nflverse roster rows -> latest team per player", () => {
  it("keeps the most recent week's team, so a mid-season trade wins over the week-1 team (Josh Downs, IND -> KC)", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Josh Downs", position: "WR", team: "IND", week: "1", status: "ACT" },
      { full_name: "Josh Downs", position: "WR", team: "KC", week: "11", status: "ACT" },
    ]);
    expect(latest.get(rosterKey("Josh Downs", "WR"))).toEqual({ team: "KC", week: 11 });
  });

  it("ignores cut and retired rows, so a released player is not re-assigned to the team that cut him", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Jha'Quan Jackson", position: "WR", team: "TB", week: "1", status: "CUT" },
      { full_name: "Teddy Bridgewater", position: "QB", team: "DET", week: "11", status: "RET" },
      { full_name: "Jonnu Smith", position: "TE", team: "GB", week: "10", status: "ACT" },
    ]);
    expect(latest.has(rosterKey("Jha'Quan Jackson", "WR"))).toBe(false);
    expect(latest.has(rosterKey("Teddy Bridgewater", "QB"))).toBe(false);
    expect(latest.get(rosterKey("Jonnu Smith", "TE"))?.team).toBe("GB");
  });

  it("normalizes nflverse team codes to CVC's (LA -> LAR, JAX -> JAC) and keys by name plus position", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Chris Smith", position: "WR", team: "LA", week: "11", status: "ACT" },
      { full_name: "Chris Smith", position: "RB", team: "JAX", week: "11", status: "ACT" },
      { full_name: "Some Lineman", position: "OL", team: "KC", week: "11", status: "ACT" },
    ]);
    expect(latest.get(rosterKey("Chris Smith", "WR"))?.team).toBe("LAR");
    expect(latest.get(rosterKey("Chris Smith", "RB"))?.team).toBe("JAC");
    expect(latest.size).toBe(2);
  });
});
