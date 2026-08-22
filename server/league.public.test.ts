import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("CVC public league procedures", () => {
  it("returns the seeded league overview and standings inputs", async () => {
    const overview = await appRouter.createCaller(createPublicContext()).league.overview();

    expect(overview.league.name).toBe("CVC Fantasy Football");
    expect(overview.season.year).toBe(2026);
    expect(overview.franchises.length).toBeGreaterThanOrEqual(6);
    expect(overview.matchups.length).toBeGreaterThanOrEqual(3);
  });

  it("reports configured records for every required league-domain module", async () => {
    const modules = await appRouter.createCaller(createPublicContext()).league.setupSummary();
    const populated = new Map(modules.map(module => [module.table, module.count]));

    expect(modules).toHaveLength(17);
    expect(populated.get("league")).toBeGreaterThan(0);
    expect(populated.get("franchise")).toBeGreaterThan(0);
    expect(populated.get("transaction")).toBeGreaterThan(0);
    expect(populated.get("league_financial_entry")).toBeGreaterThan(0);
  });

  it("exposes only real unrostered CVC players in the free-agent pool", async () => {
    const players = await appRouter.createCaller(createPublicContext()).league.freeAgents();

    expect(players.every(player => player.provider !== "placeholder")).toBe(true);
  });
});
