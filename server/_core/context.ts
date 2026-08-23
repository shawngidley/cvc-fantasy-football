import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getCvcOwnerSession } from "../cvcOwnerAuth";

export type CvcUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: CvcUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: CvcUser | null = null;

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
