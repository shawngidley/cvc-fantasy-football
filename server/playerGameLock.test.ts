import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./nflDataAdapter", () => {
  class Tank01NFLDataAdapter {}
  return {
    Tank01NFLDataAdapter,
    getNFLDataAdapter: vi.fn(),
  };
});

// playerGameLock.ts's own 10-minute cache (getCachedGamesForWeek) reuses tank01Proxy's
// shared-cache helpers for its L2 -- mocked here so these tests exercise the module's
// L1 in-memory memo deterministically, without a real (and in this sandbox, doomed)
// network round trip to Supabase. Defaults to "always miss" (null)/"always succeeds";
// individual tests override these to simulate a real L2 hit.
vi.mock("./tank01Proxy", () => ({
  readSharedCache: vi.fn().mockResolvedValue(null),
  writeSharedCache: vi.fn().mockResolvedValue(undefined),
}));

const { getNFLDataAdapter, Tank01NFLDataAdapter } = await import("./nflDataAdapter");
const { readSharedCache, writeSharedCache } = await import("./tank01Proxy");
const { hasPlayerGameStarted, isPlayerLockedForGameStart, getLockedNflTeamsForWeek, isTeamLocked, __clearLockGamesCacheForTests } = await import("./playerGameLock");

function mockAdapter(games: { away?: string; home?: string; gameDate?: string; gameTime?: string }[]) {
  const adapter = Object.create(Tank01NFLDataAdapter.prototype);
  adapter.listGamesForWeek = vi.fn().mockResolvedValue(games);
  (getNFLDataAdapter as any).mockReturnValue(adapter);
  return adapter;
}

// The lock's own cache (getCachedGamesForWeek) is module-level state shared across
// every test in this file (by design -- it's meant to persist across requests within
// the same process). Reset it, and the shared-cache mocks' default behavior, before
// each test so one test's cached result can't leak into the next and silently skip a
// mocked adapter that test expects to be called.
beforeEach(() => {
  __clearLockGamesCacheForTests();
  (readSharedCache as any).mockReset().mockResolvedValue(null);
  (writeSharedCache as any).mockReset().mockResolvedValue(undefined);
});

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

describe("getCachedGamesForWeek (the lock's own 10-minute cache, shared by hasPlayerGameStarted + getLockedNflTeamsForWeek)", () => {
  it("shares one upstream call across repeated lock checks for the same week+season", async () => {
    const adapter = mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    await getLockedNflTeamsForWeek(4, 2026);
    await getLockedNflTeamsForWeek(4, 2026);
    await getLockedNflTeamsForWeek(4, 2026);
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(1);
  });

  it("shares the cached list across different lock functions that key identically", async () => {
    const adapter = mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    await getLockedNflTeamsForWeek(4, 2026); // populates the cache for week 4 / 2026
    await hasPlayerGameStarted("KC", 4, 2026); // same week+season -- must reuse it, not refetch
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(1);
  });

  it("scopes the cache per week+season -- a different week or season is a separate cache entry", async () => {
    const adapter = mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    await getLockedNflTeamsForWeek(4, 2026);
    await getLockedNflTeamsForWeek(5, 2026); // different week
    await getLockedNflTeamsForWeek(4, 2027); // different season
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(3);
  });

  it("warms the shared L2 cache (writeSharedCache) after a real fetch, keyed with the lock-specific prefix", async () => {
    mockAdapter([{ away: "KC", home: "DEN", gameDate: "20260913", gameTime: "1:00p" }]);
    await getLockedNflTeamsForWeek(4, 2026);
    expect(writeSharedCache).toHaveBeenCalledTimes(1);
    const [cacheKey] = (writeSharedCache as any).mock.calls[0];
    expect(cacheKey).toBe("lock:getNFLGamesForWeek?week=4&season=2026");
  });

  it("reads the shared L2 cache (readSharedCache) before falling back to the adapter", async () => {
    // Far-future kickoff on both the adapter's and the cache's game, so "has it kicked
    // off" is unambiguously false on either real-clock test run -- what's under test
    // here is WHICH list gets used (cached vs. adapter), not the kickoff math itself.
    const adapter = mockAdapter([{ away: "KC", home: "DEN", gameDate: "20991231", gameTime: "1:00p" }]);
    (readSharedCache as any).mockResolvedValueOnce({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{ away: "SF", home: "LAR", gameDate: "20991231", gameTime: "1:00p" }]),
    });
    const locked = await getLockedNflTeamsForWeek(4, 2026);
    // The real proof this came from the cache and not the adapter: the adapter (KC/DEN)
    // was never called at all -- only the cached list (SF/LAR) was available to read from.
    expect(adapter.listGamesForWeek).not.toHaveBeenCalled();
    expect(locked.size).toBe(0); // neither game has kicked off
  });

  // GUARD TEST -- load-bearing. Verified by temporarily deleting the two `if (games.length)`
  // guards in getCachedGamesForWeek (so it would cache/accept an empty list) and
  // confirming this test fails, then restoring them.
  it("never accepts an empty list from the shared cache -- treats it as a miss and refetches", async () => {
    const adapter = mockAdapter([{ away: "KC", home: "DEN", gameDate: "20991231", gameTime: "1:00p" }]);
    (readSharedCache as any).mockResolvedValueOnce({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    const locked = await getLockedNflTeamsForWeek(4, 2026);
    // If the empty cached list had been trusted, this would return with nothing locked
    // and never touch the adapter at all -- a real kickoff would stay invisible to every
    // owner, league-wide, for the rest of the 10-minute window.
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(1);
    expect(locked.size).toBe(0); // KC/DEN game here hasn't kicked off yet -- correctly not locked for the RIGHT reason
  });

  // GUARD TEST -- load-bearing, same verification method as above.
  it("never writes an empty list to the cache -- a later call still refetches instead of trusting it", async () => {
    const adapter = mockAdapter([]); // simulates a Tank01 200-with-empty-body blip
    await getLockedNflTeamsForWeek(6, 2026);
    expect(writeSharedCache).not.toHaveBeenCalled(); // the empty result must never be published
    adapter.listGamesForWeek.mockResolvedValue([{ away: "KC", home: "DEN", gameDate: "20991231", gameTime: "1:00p" }]);
    await getLockedNflTeamsForWeek(6, 2026); // same cache key -- if the empty list had been
    // memoed, this would short-circuit and never reach the adapter a second time
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
  });
});
