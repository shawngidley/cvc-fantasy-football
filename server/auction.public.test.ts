import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("CVC auction eligibility", () => {
  it("returns only real, non-rookie player records in the regular auction pool", async () => {
    const players = await appRouter.createCaller(createPublicContext()).auction.eligiblePlayers();

    expect(players.every(player => player.provider !== "placeholder")).toBe(true);
    expect(players.every(player => !((player.metadata ?? {}) as { is_rookie?: boolean }).is_rookie)).toBe(true);
  });
});
