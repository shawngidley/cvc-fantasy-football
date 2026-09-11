import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./nflDataAdapter", () => {
  class Tank01NFLDataAdapter {}
  return {
    Tank01NFLDataAdapter,
    getNFLDataAdapter: vi.fn(),
  };
});

const { getNFLDataAdapter, Tank01NFLDataAdapter } = await import("./nflDataAdapter");
const { hasPlayerGameStarted, isPlayerLockedForGameStart } = await import("./playerGameLock");

function mockAdapter(games: { away?: string; home?: string; gameDate?: string; gameTime?: string }[]) {
  const adapter = Object.create(Tank01NFLDataAdapter.prototype);
  adapter.listGamesForWeek = vi.fn().mockResolvedValue(games);
  (getNFLDataAdapter as any).mockReturnValue(adapter);
  return adapter;
}

describe("hasPlayerGameStarted", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("is NOT locked for a team on a bye (no game scheduled this week)", async () => {
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    expect(await hasPlayerGameStarted("NE", 1, 2026)).toBe(false); // NE has no game in this week's schedule
  });

  it("is NOT locked when the team's game hasn't kicked off yet", async () => {
    const kickoff = Date.UTC(2026, 8, 13, 17, 0, 0); // 1pm ET Sunday
    vi.useFakeTimers();
    vi.setSystemTime(kickoff - 60 * 60 * 1000); // 1 hour before kickoff
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    expect(await hasPlayerGameStarted("KC", 1, 2026)).toBe(false);
  });

  it("IS locked once the team's game has kicked off", async () => {
    const kickoff = Date.UTC(2026, 8, 13, 17, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 60 * 60 * 1000); // 1 hour after kickoff
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    expect(await hasPlayerGameStarted("KC", 1, 2026)).toBe(true);
    expect(await hasPlayerGameStarted("DEN", 1, 2026)).toBe(true); // home side too
  });

  it("returns false immediately for no team at all (e.g. an unrostered/unknown player)", async () => {
    expect(await hasPlayerGameStarted(null, 1, 2026)).toBe(false);
    expect(await hasPlayerGameStarted(undefined, 1, 2026)).toBe(false);
  });

  it("throws when the adapter isn't configured, rather than silently returning false", async () => {
    (getNFLDataAdapter as any).mockReturnValue({});
    await expect(hasPlayerGameStarted("KC", 1, 2026)).rejects.toThrow();
  });
});

describe("isPlayerLockedForGameStart (fail-safe wrapper)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("treats an unverifiable check (adapter not configured) as LOCKED -- fail-safe, not fail-open", async () => {
    (getNFLDataAdapter as any).mockReturnValue({});
    expect(await isPlayerLockedForGameStart("KC", 1, 2026)).toBe(true);
  });

  it("treats a thrown schedule-fetch error as LOCKED too", async () => {
    const adapter = Object.create(Tank01NFLDataAdapter.prototype);
    adapter.listGamesForWeek = vi.fn().mockRejectedValue(new Error("Tank01 schedule request failed"));
    (getNFLDataAdapter as any).mockReturnValue(adapter);
    expect(await isPlayerLockedForGameStart("KC", 1, 2026)).toBe(true);
  });

  it("still correctly returns false (not locked) for a legitimately bye/no-game player", async () => {
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    expect(await isPlayerLockedForGameStart("NE", 1, 2026)).toBe(false);
  });
});
