import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthenticatedContext(openId: string): TrpcContext {
  return {
    user: {
      id: 999,
      openId,
      name: "Permission Test",
      email: "permission.test@example.test",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("CVC commissioner boundaries", () => {
  it("rejects a franchise mutation for an authenticated account without a CVC commissioner role", async () => {
    const caller = appRouter.createCaller(createAuthenticatedContext("not-a-cvc-commissioner"));
    await expect(caller.league.saveFranchise({ name: "Unauthorized Test", abbreviation: "UAT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a Protections release request from an account without a CVC owner record", async () => {
    const caller = appRouter.createCaller(createAuthenticatedContext("not-a-cvc-owner"));
    await expect(caller.league.cutContractPlayer({
      franchiseId: "11111111-1111-4111-8111-111111111111",
      playerId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an invalid roster-slot configuration before it can be saved", async () => {
    const caller = appRouter.createCaller(createAuthenticatedContext("not-a-cvc-commissioner"));
    await expect(caller.league.saveRosterSlot({ code: "BAD", label: "Invalid", positions: ["QB"], slotGroup: "starter", minimum: 3, maximum: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a trade proposal from an account without an active CVC franchise", async () => {
    const caller = appRouter.createCaller(createAuthenticatedContext("not-a-cvc-owner"));
    await expect(caller.league.proposeTrade({
      recipientFranchiseId: "11111111-1111-4111-8111-111111111111",
      offerPlayerIds: ["22222222-2222-4222-8222-222222222222"],
      requestPlayerIds: ["33333333-3333-4333-8333-333333333333"],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
