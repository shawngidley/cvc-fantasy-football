import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { CVC_AUCTION_POSITIONS, calculateAuctionLegalMaxBid } from "./routers/auction";

function createPublicContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("CVC auction eligibility", () => {
  it("returns only real, non-rookie player records in the regular auction pool", async () => {
    const players = await appRouter.createCaller(createPublicContext()).auction.eligiblePlayers();

    expect(players.every(player => player.provider !== "placeholder")).toBe(true);
    expect(players.every(player => !((player.metadata ?? {}) as { is_rookie?: boolean }).is_rookie)).toBe(true);
    expect(players.every(player => CVC_AUCTION_POSITIONS.includes(player.position as typeof CVC_AUCTION_POSITIONS[number]))).toBe(true);
  });

  it("preserves the required $1 reserve for every open roster spot through the 15-player minimum", () => {
    expect(calculateAuctionLegalMaxBid(115, 0, 0)).toBe(101);
    expect(calculateAuctionLegalMaxBid(115, 60, 10)).toBe(51);
    expect(calculateAuctionLegalMaxBid(115, 60, 14)).toBe(55);
    expect(calculateAuctionLegalMaxBid(115, 60, 15)).toBe(55);
  });

  it("accepts bounded name and position filters for the regular auction pool", async () => {
    const players = await appRouter.createCaller(createPublicContext()).auction.eligiblePlayers({ search: "A.J.", position: "WR", limit: 25 });

    expect(players.length).toBeLessThanOrEqual(25);
    expect(players.every(player => player.display_name.toLowerCase().includes("a.j.") && player.position === "WR")).toBe(true);
  });

  it("returns no auction players for an individual defensive position filter", async () => {
    const players = await appRouter.createCaller(createPublicContext()).auction.eligiblePlayers({ position: "CB" });
    expect(players).toEqual([]);
  });
});
