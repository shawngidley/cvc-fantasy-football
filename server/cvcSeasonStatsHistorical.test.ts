import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { from: vi.fn() },
  unwrap: (value: unknown) => value,
}));

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

/**
 * Stands up just enough of the Supabase client for backfillHistoricalSeasonStats: every
 * builder method chains, and awaiting the builder resolves to whatever that table should
 * return (mocked `unwrap` is the identity function, so the awaited value IS the data).
 */
function stubSupabase(players: { id: string; display_name: string; position: string; metadata: null }[]) {
  const seen = { upserts: 0 };
  const build = (resolve: () => unknown) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "neq", "in", "order", "eq", "limit", "maybeSingle", "single"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.upsert = vi.fn(() => { seen.upserts += 1; return builder; });
    builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled);
    return builder;
  };
  return {
    seen,
    from: (table: string) => {
      if (table === "player") return build(() => players);
      // No player has been backfilled for this year yet, so every one of them is pending.
      if (table === "cvc_season_stats_historical") return build(() => []);
      if (table === "season") return build(() => ({ id: "season-1" }));
      return build(() => []);
    },
  };
}

/**
 * Each player "costs" msPerPlayer on a fake clock, so a chunk of CONCURRENCY players
 * advances time deterministically without the test actually waiting.
 */
async function runBackfill(opts: { pending: number; timeBudgetMs: number; msPerPlayer: number }) {
  const players = Array.from({ length: opts.pending }, (_, i) => ({
    id: `p${i}`, display_name: `Player ${i}`, position: "WR", metadata: null,
  }));

  const { supabase } = await import("./supabase");
  const stub = stubSupabase(players);
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(stub.from);

  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);

  vi.doMock("./nflDataAdapter", () => {
    class Tank01NFLDataAdapter {
      async getPlayerInfoById() { return { espnID: "espn-1" }; }
      async getPlayerInfo() { return { espnID: "espn-1" }; }
    }
    return { Tank01NFLDataAdapter, getNFLDataAdapter: () => new Tank01NFLDataAdapter() };
  });

  vi.doMock("./playerCareerStats", () => ({
    getCvcPlayerCareerStats: async (_espnId: string, _pos: string, _rules: unknown, year: number) => {
      now += opts.msPerPlayer; // the real cost of this call is the ESPN gamelog fetch
      return [{ season: year }];
    },
    toCvcSeasonStatsShape: () => ({ fantasy_points: 0 }),
  }));

  const { backfillHistoricalSeasonStats } = await import("./cvcSeasonStatsHistorical");
  const result = await backfillHistoricalSeasonStats(2025, 1000, opts.timeBudgetMs);
  return { result, upserts: stub.seen.upserts };
}

describe("backfillHistoricalSeasonStats time budget", () => {
  it("stops between chunks once the budget is spent and reports the real remaining count", async () => {
    // 50 pending, CONCURRENCY 10 -> 5 chunks of 100ms each. The budget check runs before
    // each chunk: 0ms ok, 100ms ok, 200ms ok, then 300ms > 250ms breaks. So exactly three
    // chunks (30 players) are attempted and 20 are left for the next invocation.
    const { result, upserts } = await runBackfill({ pending: 50, timeBudgetMs: 250, msPerPlayer: 10 });

    expect(result.attempted).toBe(30);
    expect(result.remaining).toBe(20);
    expect(result.status).toBe("in_progress");
    // The regression this guards: before the fix these were batch.length (50) and 0, so a
    // run that stopped early still claimed the whole year was done.
    expect(result.attempted).not.toBe(50);
    expect(upserts).toBe(30);
    // Every attempted player really went down the happy path -- if the Supabase stub threw,
    // the loop's catch would have silently scored them as notFound instead.
    expect(result.updated).toBe(30);
    expect(result.notFound).toBe(0);
  });

  it("completes the whole batch when the budget is generous", async () => {
    const { result, upserts } = await runBackfill({ pending: 50, timeBudgetMs: 260_000, msPerPlayer: 10 });

    expect(result.attempted).toBe(50);
    expect(result.remaining).toBe(0);
    expect(result.status).toBe("completed");
    expect(result.updated).toBe(50);
    expect(upserts).toBe(50);
  });
});
