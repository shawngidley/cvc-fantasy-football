import { describe, expect, it } from "vitest";
import { FREE_AGENT_TEAM, latestTeamsFromRosterRows, rosterKey } from "./nflTeamAssignmentRules";

describe("nflverse roster rows -> current team per player", () => {
  it("takes the player's row as his current team (Josh Downs, traded to KC at the deadline, has a single KC row)", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Josh Downs", position: "WR", team: "KC", week: "11", status: "ACT" },
    ]);
    expect(latest.get(rosterKey("Josh Downs", "WR"))).toEqual({ team: "KC", week: 11 });
  });

  it("if a player ever has more than one row, the latest week wins", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Josh Downs", position: "WR", team: "IND", week: "1", status: "ACT" },
      { full_name: "Josh Downs", position: "WR", team: "KC", week: "11", status: "ACT" },
    ]);
    expect(latest.get(rosterKey("Josh Downs", "WR"))?.team).toBe("KC");
  });

  it("resolves cut and retired rows to FA, so a released player is cleared off the team that let him go", () => {
    const latest = latestTeamsFromRosterRows([
      { full_name: "Bailey Zappe", position: "QB", team: "NYJ", week: "3", status: "CUT" },
      { full_name: "Adam Thielen", position: "WR", team: "MIN", week: "11", status: "RET" },
      { full_name: "Jonnu Smith", position: "TE", team: "GB", week: "10", status: "ACT" },
      { full_name: "Injured Guy", position: "RB", team: "DAL", week: "11", status: "RES" },
    ]);
    expect(latest.get(rosterKey("Bailey Zappe", "QB"))?.team).toBe(FREE_AGENT_TEAM);
    expect(latest.get(rosterKey("Adam Thielen", "WR"))?.team).toBe(FREE_AGENT_TEAM);
    expect(latest.get(rosterKey("Jonnu Smith", "TE"))?.team).toBe("GB");
    expect(latest.get(rosterKey("Injured Guy", "RB"))?.team).toBe("DAL");
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
