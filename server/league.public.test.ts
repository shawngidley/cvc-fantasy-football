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

  it("does not expose active roster names as provider-duplicate free agents", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const [overview, freeAgents] = await Promise.all([caller.league.overview(), caller.league.freeAgents()]);
    const rosters = await Promise.all(overview.franchises.map(franchise => caller.league.franchiseRoster({ franchiseId: franchise.id })));
    const activeNames = new Set(
      rosters.flatMap(roster => roster.players.map(player => player.player?.display_name.trim().toLowerCase()).filter(Boolean)),
    );

    expect(freeAgents.every(player => !activeNames.has(player.display_name.trim().toLowerCase()))).toBe(true);
  });

  it("accepts bounded name and position filters for the live free-agent pool", async () => {
    const players = await appRouter.createCaller(createPublicContext()).league.freeAgents({ search: "A.J.", position: "WR", limit: 25 });

    expect(players.length).toBeLessThanOrEqual(25);
    expect(players.every(player => player.display_name.toLowerCase().includes("a.j.") && player.position === "WR")).toBe(true);
  });
});
