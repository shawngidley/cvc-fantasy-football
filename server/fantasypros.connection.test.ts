import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFantasyProsInjuries, getFantasyProsRanks } from "./fantasyProsNews";

// CVC no longer calls api.fantasypros.com directly for news/injuries/rankings/
// projections -- WRC now runs a scheduled fetcher that stores every dataset and
// exposes it at wrcfantasyfootball.com/api/fantasypros/feed, shared to avoid both
// sites hitting FantasyPros' 500 requests/day budget and 429ing each other. This file
// used to be a live smoke test of the FantasyPros connection itself; that connection
// no longer exists here, so it now verifies the feed adapter's fallback behavior
// instead, with the network mocked.
describe("FantasyPros feed adapter (server/fantasyProsNews.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty result instead of throwing when FANTASYPROS_FEED_SECRET is not configured, and never calls fetch", async () => {
    delete process.env.FANTASYPROS_FEED_SECRET;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const injuries = await getFantasyProsInjuries(2026, 101);
    expect(injuries).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an empty result instead of throwing on a non-2xx feed response (401, 404, or 5xx alike)", async () => {
    process.env.FANTASYPROS_FEED_SECRET = "test-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 404 } as any);
    const injuries = await getFantasyProsInjuries(2026, 102);
    expect(injuries).toEqual([]);
  });

  it("never requests api.fantasypros.com -- only WRC's shared feed host, with the feed secret header", async () => {
    process.env.FANTASYPROS_FEED_SECRET = "test-secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ injuries: [] }),
    } as any);
    await getFantasyProsInjuries(2026, 103);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("wrcfantasyfootball.com/api/fantasypros/feed");
    expect(url).not.toContain("api.fantasypros.com");
    expect(url).toContain("key=injuries%3A2026%3Aweek%3A103");
    expect((init.headers as Record<string, string>)["x-feed-secret"]).toBe("test-secret");
  });

  it("returns an empty result for the OP position without ever calling fetch -- WRC's feed has no OP key", async () => {
    process.env.FANTASYPROS_FEED_SECRET = "test-secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ranks = await getFantasyProsRanks(2026, "OP", 104);
    expect(ranks).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
