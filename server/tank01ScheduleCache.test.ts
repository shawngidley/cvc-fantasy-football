import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = new Map<string, string>();
vi.mock("./tank01Proxy", () => ({
  readSharedCache: vi.fn(async (key: string) => (shared.has(key) ? { status: 200, contentType: "application/json", body: shared.get(key)! } : null)),
  writeSharedCache: vi.fn(async (key: string, _s: number, _c: string, body: string) => { shared.set(key, body); }),
}));

import { __clearCronScheduleCacheForTests, listGamesForWeekForCron } from "./tank01ScheduleCache";

const game = { gameID: "20261011_A@B", away: "A", home: "B", gameDate: "20261011", gameTime: "1:00p" };
const makeAdapter = (games: unknown[]) => ({ listGamesForWeek: vi.fn(async () => games) }) as any;

// Fixed instants, not wall-clock dependent (EDT = UTC-4).
const TUE_9AM = new Date(Date.UTC(2026, 9, 6, 13, 0)); // Tue Oct 6 9:00am ET, off-window
const SUN_1PM = new Date(Date.UTC(2026, 9, 11, 17, 0)); // Sun Oct 11 1:00pm ET, in-window

describe("listGamesForWeekForCron", () => {
  beforeEach(() => { shared.clear(); __clearCronScheduleCacheForTests(); });

  it("off-window: second call within the hour does not hit Tank01 again", async () => {
    const adapter = makeAdapter([game]);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    await listGamesForWeekForCron(adapter, 5, 2026, new Date(TUE_9AM.getTime() + 5 * 60_000));
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(1);
  });

  it("off-window: refetches once the 60 minute TTL has passed", async () => {
    const adapter = makeAdapter([game]);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    __clearCronScheduleCacheForTests(); shared.clear(); // simulate expiry in both layers
    await listGamesForWeekForCron(adapter, 5, 2026, new Date(TUE_9AM.getTime() + 61 * 60_000));
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
  });

  it("off-window: memo expires by its own clock after 60 minutes even if shared cache is gone", async () => {
    const adapter = makeAdapter([game]);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    shared.clear();
    await listGamesForWeekForCron(adapter, 5, 2026, new Date(TUE_9AM.getTime() + 61 * 60_000));
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
  });

  it("in-window: always fetches fresh and never reads or fills the cache", async () => {
    const adapter = makeAdapter([game]);
    await listGamesForWeekForCron(adapter, 5, 2026, SUN_1PM);
    await listGamesForWeekForCron(adapter, 5, 2026, SUN_1PM);
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
    expect(shared.size).toBe(0);
  });

  it("never caches an empty list (a 200 with an empty body must not stick for an hour)", async () => {
    const adapter = makeAdapter([]);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
    expect(shared.size).toBe(0);
  });

  it("never accepts an empty list from the shared cache", async () => {
    shared.set("cron:getNFLGamesForWeek?week=5&season=2026", "[]");
    const adapter = makeAdapter([game]);
    const games = await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(1);
    expect(games).toHaveLength(1);
  });

  it("serves another instance from the shared cache without calling Tank01", async () => {
    const a = makeAdapter([game]);
    await listGamesForWeekForCron(a, 5, 2026, TUE_9AM);
    __clearCronScheduleCacheForTests(); // a different serverless instance: empty memo, same shared table
    const b = makeAdapter([game]);
    await listGamesForWeekForCron(b, 5, 2026, new Date(TUE_9AM.getTime() + 10 * 60_000));
    expect(b.listGamesForWeek).not.toHaveBeenCalled();
  });

  it("keys by week and season", async () => {
    const adapter = makeAdapter([game]);
    await listGamesForWeekForCron(adapter, 5, 2026, TUE_9AM);
    await listGamesForWeekForCron(adapter, 6, 2026, TUE_9AM);
    expect(adapter.listGamesForWeek).toHaveBeenCalledTimes(2);
  });
});
