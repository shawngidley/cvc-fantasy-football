import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearEspnProxyCacheForTests, proxyEspnScoreboard, proxyEspnSummary } from "./espnProxy";

function mockReqRes(query: Record<string, string>) {
  const req = { query } as any;
  const jsonSpy = vi.fn();
  const statusSpy = vi.fn(() => ({ json: jsonSpy }));
  const res = { status: statusSpy, json: jsonSpy } as any;
  return { req, res, jsonSpy, statusSpy };
}

describe("proxyEspnScoreboard / proxyEspnSummary caching", () => {
  beforeEach(() => {
    __clearEspnProxyCacheForTests();
    vi.restoreAllMocks();
  });

  it("serves a second scoreboard request for the same date from cache instead of calling upstream again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ events: [] }) } as any);

    const first = mockReqRes({ dates: "20260913" });
    await proxyEspnScoreboard(first.req, first.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = mockReqRes({ dates: "20260913" });
    await proxyEspnScoreboard(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1 -- served from cache
    expect(second.statusSpy).toHaveBeenCalledWith(200);
  });

  it("does NOT cache a failed upstream response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 502 } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ events: [] }) } as any);

    const first = mockReqRes({ dates: "20260913" });
    await proxyEspnScoreboard(first.req, first.res);
    expect(first.statusSpy).toHaveBeenCalledWith(502);

    const second = mockReqRes({ dates: "20260913" });
    await proxyEspnScoreboard(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // retried upstream, not served a cached failure
    expect(second.jsonSpy).toHaveBeenCalledWith({ events: [] });
  });

  it("caches proxyEspnSummary the same way, independently of the scoreboard cache", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ plays: [] }) } as any);

    const first = mockReqRes({ event: "401671807" });
    await proxyEspnSummary(first.req, first.res);
    const second = mockReqRes({ event: "401671807" });
    await proxyEspnSummary(second.req, second.res);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
