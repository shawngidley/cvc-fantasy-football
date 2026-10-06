import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the shared L2 cache out of these tests -- it's best-effort and every read
// here should miss so behavior matches the in-memory-only assertions below, without
// actually touching Supabase.
vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}));

import { __clearTank01ProxyCacheForTests, proxyTank01Request, resolveCacheTtlMs } from "./tank01Proxy";

// A fixed, confirmed-live instant (Sun Oct 4 2026, 1:00pm ET / 17:00 UTC) and a fixed,
// confirmed-off-window instant (Tue Oct 6 2026, 3:00pm ET / 19:00 UTC) -- see
// tank01LiveWindow.test.ts for how these were verified against Intl, not assumed.
const LIVE_WINDOW_INSTANT = Date.UTC(2026, 9, 4, 17, 0, 0);
const OFF_WINDOW_INSTANT = Date.UTC(2026, 9, 6, 19, 0, 0);

function mockReqRes(endpoint: string, query: Record<string, string>) {
  const req = { params: { endpoint }, query } as any;
  const jsonSpy = vi.fn();
  const sendSpy = vi.fn();
  const typeSpy = vi.fn(() => ({ send: sendSpy }));
  const statusSpy = vi.fn(() => ({ json: jsonSpy, type: typeSpy, send: sendSpy }));
  const res = { status: statusSpy, json: jsonSpy, type: typeSpy, send: sendSpy } as any;
  return { req, res, jsonSpy, sendSpy, typeSpy, statusSpy };
}

describe("proxyTank01Request caching", () => {
  beforeEach(() => {
    __clearTank01ProxyCacheForTests();
    process.env.TANK01_RAPIDAPI_KEY = "test-key";
    vi.restoreAllMocks();
  });

  it("serves a second request for the same endpoint+params from cache instead of calling upstream again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ body: "real data" }),
    } as any);

    const first = mockReqRes("getNFLBoxScore", { gameID: "20260909_NE@SEA" });
    await proxyTank01Request(first.req, first.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = mockReqRes("getNFLBoxScore", { gameID: "20260909_NE@SEA" });
    await proxyTank01Request(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1 -- served from cache, not a second upstream call
    expect(second.statusSpy).toHaveBeenCalledWith(200);
  });

  it("does NOT cache a failed upstream response -- a transient error must not get stuck and repeatedly served", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 502, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ error: "upstream down" }) } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ body: "recovered" }) } as any);

    const first = mockReqRes("getNFLBoxScore", { gameID: "20260909_NE@SEA" });
    await proxyTank01Request(first.req, first.res);
    expect(first.statusSpy).toHaveBeenCalledWith(502);

    const second = mockReqRes("getNFLBoxScore", { gameID: "20260909_NE@SEA" });
    await proxyTank01Request(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // retried upstream, not served a cached failure
    expect(second.statusSpy).toHaveBeenCalledWith(200);
  });

  it("treats different query params as separate cache entries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ body: "data" }),
    } as any);

    const a1 = mockReqRes("getNFLBoxScore", { gameID: "gameA" });
    await proxyTank01Request(a1.req, a1.res);
    const a2 = mockReqRes("getNFLBoxScore", { gameID: "gameA" });
    await proxyTank01Request(a2.req, a2.res);
    const b = mockReqRes("getNFLBoxScore", { gameID: "gameB" });
    await proxyTank01Request(b.req, b.res);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // gameA fetched once (a2 hit cache), gameB fetched separately
  });
});

describe("resolveCacheTtlMs", () => {
  it("gives getNFLBoxScore the short in-game TTL during a live window", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(50_000);
  });

  it("gives getNFLBoxScore the long off-window TTL when no game could be live", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
  });

  it("gives getNFLGamesForWeek the short in-game TTL during a live window", () => {
    expect(resolveCacheTtlMs("getNFLGamesForWeek", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(5 * 60_000);
  });

  it("gives getNFLGamesForWeek a full hour off-window -- the week's kickoff times are set once no game can be live", () => {
    expect(resolveCacheTtlMs("getNFLGamesForWeek", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(60 * 60_000);
  });

  it("gives every static endpoint its configured TTL regardless of live window", () => {
    expect(resolveCacheTtlMs("getNFLNews", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLPlayerInfo", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLGamesForPlayer", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLProjections", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(60 * 60_000);
    expect(resolveCacheTtlMs("getNFLTeamSchedule", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLTeams", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLADP", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLDepthCharts", new URLSearchParams(), OFF_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
  });

  it("falls back to the 20s default for an unrecognized endpoint", () => {
    expect(resolveCacheTtlMs("someFutureEndpoint", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(20_000);
  });
});

describe("proxyTank01Request end-to-end: off-window TTL actually gets applied to a live endpoint", () => {
  beforeEach(() => {
    __clearTank01ProxyCacheForTests();
    process.env.TANK01_RAPIDAPI_KEY = "test-key";
    vi.restoreAllMocks();
  });

  it("serves a cached getNFLBoxScore response well past 50s (but under 15min) when outside the live window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OFF_WINDOW_INSTANT);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ body: "data" }),
    } as any);

    const first = mockReqRes("getNFLBoxScore", { gameID: "gameOffWindow" });
    await proxyTank01Request(first.req, first.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(OFF_WINDOW_INSTANT + 5 * 60_000); // 5 minutes later -- would have expired under the old flat 20s TTL
    const second = mockReqRes("getNFLBoxScore", { gameID: "gameOffWindow" });
    await proxyTank01Request(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still cached

    vi.useRealTimers();
  });
});

// The quiet-day leak these cover: Live Scoring re-pulls every fetch-eligible game from
// roughly the last 10 days to populate finals, so without a past-day rule every owner's
// page open re-fetched last week's already-final box scores upstream every 15 minutes.
describe("resolveCacheTtlMs: past-day (final) box scores", () => {
  const boxScore = (gameId: string) => new URLSearchParams({ gameID: gameId });

  it("caches a box score from a previous ET day for 12h, even inside a live window", () => {
    // Oct 3 game, clock pinned to Oct 4 1:00pm ET -- in-window, but that game is final.
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261003_NE@SEA"), LIVE_WINDOW_INSTANT)).toBe(12 * 60 * 60_000);
  });

  it("caches a past-day box score for 12h off-window too", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261003_NE@SEA"), OFF_WINDOW_INSTANT)).toBe(12 * 60 * 60_000);
  });

  it("keeps TODAY's game on the short live TTL -- it may still be in progress", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261004_NE@SEA"), LIVE_WINDOW_INSTANT)).toBe(50_000);
  });

  it("keeps a SAME-DAY game on the normal off-window TTL, not the 12h final TTL", () => {
    // gameID day == the pinned clock's ET day (Oct 6, the off-window instant), so it is
    // not past: a game that ended an hour ago can still pick up a stat correction.
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261006_ARI@LAC"), OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
  });

  it("does NOT treat a FUTURE-dated game as final", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261011_NE@SEA"), LIVE_WINDOW_INSTANT)).toBe(50_000);
  });

  it("falls back to the normal TTL for a missing or unparseable gameID rather than caching 12h", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", new URLSearchParams(), LIVE_WINDOW_INSTANT)).toBe(50_000);
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("not-a-date_NE@SEA"), LIVE_WINDOW_INSTANT)).toBe(50_000);
  });

  it("uses the ET calendar day, not UTC -- a game 'yesterday' in UTC is still today in ET", () => {
    // Mon Oct 5 2026, 00:30 UTC = Sun Oct 4, 8:30pm ET. An Oct 4 game is TODAY in ET
    // (live TTL) even though UTC has already rolled over to the 5th.
    const lateSundayNightEt = Date.UTC(2026, 9, 5, 0, 30, 0);
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261004_NE@SEA"), lateSundayNightEt)).toBe(50_000);
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261003_NE@SEA"), lateSundayNightEt)).toBe(12 * 60 * 60_000);
  });
});

// Midnight-rollover regression: during 12:00am-1:59am ET the previous day's slate is still
// live (a Sunday night game in overtime at 12:30am Monday). A past-day check built on the
// raw ET date saw gameID 20261004 vs a clock already reading 20261005, called the game a
// final, and cached its box score for 12h -- freezing Live Scoring for that game all night.
// Fixed by comparing against the ET SLATE date (tank01LiveWindow.ts nySlate).
describe("resolveCacheTtlMs: post-midnight games stay live (slate date, not raw ET date)", () => {
  const boxScore = (gameId: string) => new URLSearchParams({ gameID: gameId });
  const LIVE = 50_000;
  const FINAL = 12 * 60 * 60_000;

  it("keeps a Sunday game live at 12:30am ET Monday", () => {
    // Mon Oct 5 2026, 12:30am EDT = 04:30Z
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261004_DAL@HOU"), Date.UTC(2026, 9, 5, 4, 30, 0))).toBe(LIVE);
  });

  it("keeps a Monday-night game live at 12:30am ET Tuesday", () => {
    // Tue Oct 6 2026, 12:30am EDT = 04:30Z
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261005_NE@SEA"), Date.UTC(2026, 9, 6, 4, 30, 0))).toBe(LIVE);
  });

  it("crosses a MONTH boundary: an Oct 31 game is still live at 12:30am ET Nov 1", () => {
    // Sun Nov 1 2026, 12:30am EDT (fall-back isn't until 2am) = 04:30Z
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261031_NE@SEA"), Date.UTC(2026, 10, 1, 4, 30, 0))).toBe(LIVE);
  });

  it("crosses a YEAR boundary: a Dec 31 game is still live at 12:30am ET Jan 1", () => {
    // Fri Jan 1 2027, 12:30am EST = 05:30Z
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261231_NE@SEA"), Date.UTC(2027, 0, 1, 5, 30, 0))).toBe(LIVE);
  });

  it("still treats that same game as a final once the slate rolls over at 2:00am ET", () => {
    // Mon Oct 5 2026, 2:00am EDT = 06:00Z
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261004_DAL@HOU"), Date.UTC(2026, 9, 5, 6, 0, 0))).toBe(FINAL);
  });

  it("still treats the day-before-yesterday's game as final at 12:30am", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", boxScore("20261003_NE@SEA"), Date.UTC(2026, 9, 5, 4, 30, 0))).toBe(FINAL);
  });
});

describe("proxyTank01Request end-to-end: a past-day box score survives far past the live TTL", () => {
  beforeEach(() => {
    __clearTank01ProxyCacheForTests();
    process.env.TANK01_RAPIDAPI_KEY = "test-key";
    vi.restoreAllMocks();
  });

  it("serves an Oct 3 box score from cache an hour later while the clock sits in Oct 4's live window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(LIVE_WINDOW_INSTANT);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ body: "final" }),
    } as any);

    const first = mockReqRes("getNFLBoxScore", { gameID: "20261003_NE@SEA" });
    await proxyTank01Request(first.req, first.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(LIVE_WINDOW_INSTANT + 60 * 60_000); // 1 hour: way past 50s and past 15min
    const second = mockReqRes("getNFLBoxScore", { gameID: "20261003_NE@SEA" });
    await proxyTank01Request(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still cached under the 12h final TTL

    vi.useRealTimers();
  });
});
