import { describe, expect, it } from "vitest";
import { Tank01NFLDataAdapter } from "./nflDataAdapter";

const tank01Host = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

describe("Tank01 connection", () => {
  it("authenticates with the configured server-only RapidAPI key", async () => {
    const apiKey = process.env.TANK01_RAPIDAPI_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch(`https://${tank01Host}/getNFLTeams`, {
      headers: {
        "x-rapidapi-host": tank01Host,
        "x-rapidapi-key": apiKey!,
      },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toBeTruthy();
  }, 20_000);

  it("uses the production adapter for documented team and roster methods", async () => {
    const apiKey = process.env.TANK01_RAPIDAPI_KEY;
    expect(apiKey).toBeTruthy();
    const adapter = new Tank01NFLDataAdapter(apiKey!);
    const teams = await adapter.listTeams();
    expect(Array.isArray(teams.body)).toBe(true);
    const roster = await adapter.listTeamRoster("KC");
    expect(Array.isArray(roster)).toBe(true);
  }, 30_000);
});
