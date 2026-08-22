import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getCvcOwnerSession } from "../cvcOwnerAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const cvcSession = await getCvcOwnerSession(opts.req);
    if (cvcSession) {
      const now = new Date();
      user = {
        id: 0,
        openId: `cvc:${cvcSession.owner.id}`,
        name: cvcSession.owner.display_name,
        email: null,
        loginMethod: "cvc_pin",
        role: ["commissioner", "administrator"].includes(cvcSession.owner.role) ? "admin" : "user",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      };
    }
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
