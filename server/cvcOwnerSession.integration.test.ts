import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { createContext as createTrpcContext } from "./_core/context";
import type { TrpcContext } from "./_core/context";

type CookieWrite = { name: string; value?: string; options: Record<string, unknown> };

function createContext(cookie = ""): { ctx: TrpcContext; cookies: CookieWrite[] } {
  const cookies: CookieWrite[] = [];
  return {
    cookies,
    ctx: {
      user: null,
      req: { protocol: "https", headers: cookie ? { cookie } : {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }),
        clearCookie: (name: string, options: Record<string, unknown>) => cookies.push({ name, options }),
      } as TrpcContext["res"],
    },
  };
}

describe("CVC owner session integration", () => {
  it("authenticates the approved default PIN into a CVC-only owner session and clears it on sign out", async () => {
    const publicContext = createContext();
    const owners = await appRouter.createCaller(publicContext.ctx).ownerAuth.owners();
    const jonas = owners.find(owner => owner.displayName === "Jonas");
    expect(jonas).toBeDefined();

    const signInContext = createContext();
    const session = await appRouter.createCaller(signInContext.ctx).ownerAuth.signIn({ ownerId: jonas!.id, pin: "1234" });
    expect(session.displayName).toBe("Jonas");
    expect(session.role).toBe("commissioner");
    const sessionCookie = signInContext.cookies.find(cookie => cookie.name === "cvc_owner_session" && cookie.value);
    expect(sessionCookie?.value).toBeTruthy();
    expect(sessionCookie?.options).toMatchObject({ httpOnly: true, path: "/", secure: true });

    const authenticatedContext = createContext(`cvc_owner_session=${sessionCookie!.value}`);
    const activeSession = await appRouter.createCaller(authenticatedContext.ctx).ownerAuth.session();
    expect(activeSession?.displayName).toBe("Jonas");
    const protectedContext = await createTrpcContext({ req: authenticatedContext.ctx.req, res: authenticatedContext.ctx.res });
    const leagueAccess = await appRouter.createCaller(protectedContext).league.access();
    expect(leagueAccess).toMatchObject({ displayName: "Jonas", isCommissioner: true });
    const refresh = await appRouter.createCaller(protectedContext).league.refreshFantasyProsPlayers();
    expect(refresh).toMatchObject({ provider: "FantasyPros" });
    expect(["network", "cache", "stale_cache"]).toContain(refresh.source);
    expect(refresh.fetchedAt).toEqual(expect.any(String));
    const sync = await appRouter.createCaller(protectedContext).league.syncFantasyProsPlayers();
    expect(sync.totalReceived).toBeGreaterThan(0);
    expect(sync.inserted + sync.enriched + sync.skipped).toBe(sync.totalReceived);

    await appRouter.createCaller(authenticatedContext.ctx).ownerAuth.signOut();
    expect(authenticatedContext.cookies.some(cookie => cookie.name === "cvc_owner_session" && cookie.value === undefined)).toBe(true);
  }, 30_000);
});
