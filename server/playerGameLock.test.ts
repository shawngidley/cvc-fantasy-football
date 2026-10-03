import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./nflDataAdapter", () => {
  class Tank01NFLDataAdapter {}
  return {
    Tank01NFLDataAdapter,
    getNFLDataAdapter: vi.fn(),
  };
});

const { getNFLDataAdapter, Tank01NFLDataAdapter } = await import("./nflDataAdapter");
const { hasPlayerGameStarted, isPlayerLockedForGameStart, getLockedNflTeamsForWeek, isTeamLocked } = await import("./playerGameLock");

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

describe("getLockedNflTeamsForWeek + isTeamLocked (batch form, for rendering a whole free-agent list)", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("locks both teams of a game that already kicked off, regardless of which side is away/home", async () => {
    // Regression case for the real bug this was added to fix: a Thursday-night game
    // (CLE@PIT) that's already kicked off by the time this is checked Friday -- the
    // free-agent list's previous client-side-only "next game" heuristic missed this
    // because the daily schedule sync had already advanced each team's cached "next
    // game" to the following week by then.
    const kickoff = Date.UTC(2026, 9, 2, 0, 15, 0); // Thu Oct 1 2026, 8:15pm ET (= Oct 2 00:15 UTC)
    vi.useFakeTimers();
    vi.setSystemTime(kickoff + 60 * 60 * 1000); // Friday, 1 hour after kickoff
    mockAdapter([
      { away: "CLE", home: "PIT", gameDate: "20261001", gameTime: "8:15p" },
      { away: "LAR", home: "SF", gameDate: "20261004", gameTime: "4:25p" }, // not kicked off yet
    ]);
    const locked = await getLockedNflTeamsForWeek(4, 2026);
    expect(isTeamLocked("CLE", locked)).toBe(true);
    expect(isTeamLocked("PIT", locked)).toBe(true);
    expect(isTeamLocked("SF", locked)).toBe(false); // this week's game, but not kicked off yet
    expect(isTeamLocked("LAR", locked)).toBe(false);
  });

  it("locks no one for a bye team or a team with no game this week", async () => {
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    const locked = await getLockedNflTeamsForWeek(1, 2026);
    expect(isTeamLocked("NE", locked)).toBe(false);
  });

  it("isTeamLocked returns false for a null/undefined team rather than throwing", () => {
    const locked = new Set(["kc"]);
    expect(isTeamLocked(null, locked)).toBe(false);
    expect(isTeamLocked(undefined, locked)).toBe(false);
  });

  it("fails open (empty set, nothing shown as locked) rather than throwing when the schedule fetch errors -- this is a display hint, not the enforcement gate", async () => {
    const adapter = Object.create(Tank01NFLDataAdapter.prototype);
    adapter.listGamesForWeek = vi.fn().mockRejectedValue(new Error("Tank01 schedule request failed"));
    (getNFLDataAdapter as any).mockReturnValue(adapter);
    const locked = await getLockedNflTeamsForWeek(4, 2026);
    expect(locked.size).toBe(0);
  });

  it("fails open when the adapter isn't configured at all", async () => {
    (getNFLDataAdapter as any).mockReturnValue({});
    const locked = await getLockedNflTeamsForWeek(4, 2026);
    expect(locked.size).toBe(0);
  });
});
