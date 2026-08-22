import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./cvcOwnerAuth";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("CVC owner PIN authentication", () => {
  it("stores a salted PIN hash that only validates the correct four-digit PIN", () => {
    const hash = hashPin("1234");

    expect(hash).not.toContain("1234");
    expect(verifyPin("1234", hash)).toBe(true);
    expect(verifyPin("4321", hash)).toBe(false);
    expect(verifyPin("12345", hash)).toBe(false);
  });

  it("returns active CVC owner records for the selector without PIN data", async () => {
    const owners = await appRouter.createCaller(createPublicContext()).ownerAuth.owners();

    expect(owners.length).toBeGreaterThanOrEqual(11);
    expect(owners.some(owner => owner.displayName === "Administrator")).toBe(true);
    expect(owners.some(owner => owner.displayName === "Jonas" && owner.role === "commissioner")).toBe(true);
  });
});
