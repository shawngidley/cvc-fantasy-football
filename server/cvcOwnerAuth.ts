import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { supabase, unwrap } from "./supabase";

const PIN_PATTERN = /^\d{4}$/;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const OWNER_SESSION_DAYS = 30;

export const CVC_OWNER_SESSION_COOKIE = "cvc_owner_session";

export type CvcOwnerSession = {
  owner: { id: string; league_id: string; display_name: string; role: string };
  expiresAt: string;
};

function validatePin(pin: string) {
  if (!PIN_PATTERN.test(pin)) throw new TRPCError({ code: "BAD_REQUEST", message: "CVC owner PINs must contain exactly four digits." });
}

export function hashPin(pin: string) {
  validatePin(pin);
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, KEY_LENGTH, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION });
  return ["scrypt", SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export function verifyPin(pin: string, storedHash: string | null) {
  if (!PIN_PATTERN.test(pin) || !storedHash) return false;
  const [algorithm, cost, blockSize, parallelization, salt, expected] = storedHash.split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelization || !salt || !expected) return false;
  const expectedKey = Buffer.from(expected, "base64url");
  const derivedKey = scryptSync(pin, Buffer.from(salt, "base64url"), expectedKey.length, { N: Number(cost), r: Number(blockSize), p: Number(parallelization) });
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function sessionTokenFromRequest(req: Request) {
  const cookies = parse(req.headers.cookie ?? "");
  return cookies[CVC_OWNER_SESSION_COOKIE] ?? null;
}

export async function getCvcOwnerSession(req: Request): Promise<CvcOwnerSession | null> {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  const session = unwrap(await supabase.from("owner_session").select("owner_id, expires_at").eq("token_hash", hashSessionToken(token)).gt("expires_at", new Date().toISOString()).maybeSingle());
  if (!session) return null;
  const owner = unwrap(await supabase.from("owner").select("id, league_id, display_name, role").eq("id", session.owner_id).eq("is_active", true).maybeSingle());
  if (!owner) return null;
  return { owner, expiresAt: session.expires_at };
}

export async function requireCvcOwnerSession(req: Request) {
  const session = await getCvcOwnerSession(req);
  if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "CVC owner sign-in is required." });
  return session;
}

export async function issueCvcOwnerSession(req: Request, res: Response, ownerId: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + OWNER_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  unwrap(await supabase.from("owner_session").delete().lt("expires_at", new Date().toISOString()).select("id"));
  const session = unwrap(await supabase.from("owner_session").insert({ owner_id: ownerId, token_hash: hashSessionToken(token), expires_at: expiresAt }).select("id").single());
  if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "CVC owner session could not be created." });
  res.cookie(CVC_OWNER_SESSION_COOKIE, token, { ...getSessionCookieOptions(req), maxAge: OWNER_SESSION_DAYS * 24 * 60 * 60 * 1000 });
  return { expiresAt };
}

export async function clearCvcOwnerSession(req: Request, res: Response) {
  const token = sessionTokenFromRequest(req);
  if (token) unwrap(await supabase.from("owner_session").delete().eq("token_hash", hashSessionToken(token)).select("id"));
  res.clearCookie(CVC_OWNER_SESSION_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}
