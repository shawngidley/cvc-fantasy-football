import { describe, expect, it } from "vitest";
import { getRosterCompliance, MAX_ROSTER_PLAYERS, SALARY_CAP } from "./rosterCompliance";

const roster = (salaries: Array<number | string | null>) => salaries.map(s => ({ contract: s === null ? null : { salary: s } }));

describe("getRosterCompliance", () => {
  it("uses the CVC limits: $115 cap and 22 players", () => {
    expect(SALARY_CAP).toBe(115);
    expect(MAX_ROSTER_PLAYERS).toBe(22);
  });
  it("has no warnings at exactly the cap and exactly 22 players", () => {
    const result = getRosterCompliance(roster([...Array(21).fill(5), 10]));
    expect(result.totalSalary).toBe(115);
    expect(result.playerCount).toBe(22);
    expect(result.warnings).toEqual([]);
  });
  it("warns when payroll is over $115 and says by how much", () => {
    const result = getRosterCompliance(roster([60, 40, 17]));
    expect(result.overCapBy).toBe(2);
    expect(result.warnings.map(w => w.kind)).toEqual(["salary"]);
    expect(result.warnings[0].message).toContain("$117");
    expect(result.warnings[0].message).toContain("$2");
  });
  it("warns when there are more than 22 players and says how many to cut", () => {
    const result = getRosterCompliance(roster(Array(24).fill(1)));
    expect(result.overRosterBy).toBe(2);
    expect(result.warnings.map(w => w.kind)).toEqual(["roster"]);
    expect(result.warnings[0].message).toContain("24");
  });
  it("shows both warnings when both limits are broken", () => {
    const result = getRosterCompliance(roster(Array(23).fill(6)));
    expect(result.warnings.map(w => w.kind)).toEqual(["salary", "roster"]);
  });
  it("reads salaries stored as strings and ignores players with no contract", () => {
    const result = getRosterCompliance(roster(["100.5", "15", null]));
    expect(result.totalSalary).toBe(115.5);
    expect(result.warnings.map(w => w.kind)).toEqual(["salary"]);
  });
  it("does not warn for an empty or missing roster", () => {
    expect(getRosterCompliance([]).warnings).toEqual([]);
    expect(getRosterCompliance(undefined).warnings).toEqual([]);
  });
});
