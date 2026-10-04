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
    expect(resolveCacheTtlMs("getNFLBoxScore", LIVE_WINDOW_INSTANT)).toBe(50_000);
  });

  it("gives getNFLBoxScore the long off-window TTL when no game could be live", () => {
    expect(resolveCacheTtlMs("getNFLBoxScore", OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
  });

  it("gives getNFLGamesForWeek the short in-game TTL during a live window", () => {
    expect(resolveCacheTtlMs("getNFLGamesForWeek", LIVE_WINDOW_INSTANT)).toBe(5 * 60_000);
  });

  it("gives getNFLGamesForWeek the long off-window TTL when no game could be live", () => {
    expect(resolveCacheTtlMs("getNFLGamesForWeek", OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
  });

  it("gives every static endpoint its configured TTL regardless of live window", () => {
    expect(resolveCacheTtlMs("getNFLNews", LIVE_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLPlayerInfo", OFF_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLGamesForPlayer", LIVE_WINDOW_INSTANT)).toBe(15 * 60_000);
    expect(resolveCacheTtlMs("getNFLProjections", OFF_WINDOW_INSTANT)).toBe(60 * 60_000);
    expect(resolveCacheTtlMs("getNFLTeamSchedule", LIVE_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLTeams", OFF_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLADP", LIVE_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
    expect(resolveCacheTtlMs("getNFLDepthCharts", OFF_WINDOW_INSTANT)).toBe(6 * 60 * 60_000);
  });

  it("falls back to the 20s default for an unrecognized endpoint", () => {
    expect(resolveCacheTtlMs("someFutureEndpoint", LIVE_WINDOW_INSTANT)).toBe(20_000);
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
