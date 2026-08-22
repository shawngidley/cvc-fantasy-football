import { describe, expect, it } from "vitest";

describe("FantasyPros connection", () => {
  it("authenticates with the configured server-only API key", async () => {
    const apiKey = process.env.FANTASYPROS_API_KEY;
    expect(apiKey).toBeTruthy();

    const request = () => fetch("https://api.fantasypros.com/public/v2/json/nfl/players", {
      headers: { "x-api-key": apiKey! }, signal: AbortSignal.timeout(12_000),
    });
    let response = await request().catch(() => null);
    if (!response) {
      await new Promise(resolve => setTimeout(resolve, 1_100));
      response = await request();
    }

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toBeTruthy();
  }, 30_000);
});
