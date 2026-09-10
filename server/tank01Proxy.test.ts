import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearTank01ProxyCacheForTests, proxyTank01Request } from "./tank01Proxy";

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
