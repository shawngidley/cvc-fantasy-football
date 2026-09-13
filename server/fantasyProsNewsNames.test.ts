import { describe, expect, it } from "vitest";
import { attachFantasyProsPlayerNames } from "./fantasyProsNewsNames";

describe("attachFantasyProsPlayerNames", () => {
  it("fills in playerName/team/position by matching playerId against ranks data", () => {
    const news = [{ playerId: 23679, playerName: "", team: "" }];
    const ranks = [{ playerId: 23679, name: "Sean Tucker", team: "TB", position: "RB" }];
    const result = attachFantasyProsPlayerNames(news, ranks);
    expect(result[0]).toMatchObject({ playerName: "Sean Tucker", team: "TB", position: "RB" });
  });

  it("leaves an item unchanged if its playerId has no matching rank (e.g. a deep-roster player with no current rank)", () => {
    const news = [{ playerId: 999999, playerName: "", team: "" }];
    const ranks = [{ playerId: 23679, name: "Sean Tucker", team: "TB", position: "RB" }];
    const result = attachFantasyProsPlayerNames(news, ranks);
    expect(result[0]).toMatchObject({ playerId: 999999, playerName: "", team: "" });
  });

  it("does not overwrite an already-populated playerName/team/position", () => {
    const news = [{ playerId: 23679, playerName: "Already Set", team: "XYZ", position: "WR" }];
    const ranks = [{ playerId: 23679, name: "Sean Tucker", team: "TB", position: "RB" }];
    const result = attachFantasyProsPlayerNames(news, ranks);
    expect(result[0]).toMatchObject({ playerName: "Already Set", team: "XYZ", position: "WR" });
  });

  it("handles a null playerId without throwing", () => {
    const news = [{ playerId: null, playerName: "", team: "" }];
    const ranks = [{ playerId: 23679, name: "Sean Tucker", team: "TB", position: "RB" }];
    expect(() => attachFantasyProsPlayerNames(news, ranks)).not.toThrow();
    expect(attachFantasyProsPlayerNames(news, ranks)[0].playerName).toBe("");
  });
});
