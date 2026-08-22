import { supabase, unwrap } from "./supabase";

const CACHE_KEY = "fantasypros:nfl:players:v2";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1_100;
let lastRequestAt = 0;

export type FantasyProsSnapshot = {
  provider: "FantasyPros";
  payload: unknown;
  fetchedAt: string;
  expiresAt: string;
  source: "cache" | "network" | "stale_cache";
  lastError: string | null;
};

type CacheRow = { payload: unknown; fetched_at: string; expires_at: string; last_error: string | null };

async function waitForRequestWindow() {
  const delay = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastRequestAt = Date.now();
}

async function readCache() {
  return unwrap(await supabase.from("provider_cache").select("payload, fetched_at, expires_at, last_error").eq("cache_key", CACHE_KEY).maybeSingle()) as CacheRow | null;
}

function snapshotFromCache(cache: CacheRow, source: FantasyProsSnapshot["source"]): FantasyProsSnapshot {
  return { provider: "FantasyPros", payload: cache.payload, fetchedAt: cache.fetched_at, expiresAt: cache.expires_at, source, lastError: cache.last_error };
}

export async function fantasyProsCacheStatus() {
  const cache = await readCache();
  const now = Date.now();
  return cache ? { configured: Boolean(process.env.FANTASYPROS_API_KEY), cacheKey: CACHE_KEY, fetchedAt: cache.fetched_at, expiresAt: cache.expires_at, fresh: new Date(cache.expires_at).getTime() > now, lastError: cache.last_error } : { configured: Boolean(process.env.FANTASYPROS_API_KEY), cacheKey: CACHE_KEY, fetchedAt: null, expiresAt: null, fresh: false, lastError: null };
}

export async function getFantasyProsPlayerSnapshot(): Promise<FantasyProsSnapshot> {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) throw new Error("FantasyPros is not configured for CVC.");
  const cache = await readCache();
  if (cache && new Date(cache.expires_at).getTime() > Date.now()) return snapshotFromCache(cache, "cache");

  try {
    await waitForRequestWindow();
    const response = await fetch("https://api.fantasypros.com/public/v2/json/nfl/players", { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`FantasyPros players request failed with status ${response.status}`);
    const payload = await response.json() as unknown;
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
    unwrap(await supabase.from("provider_cache").upsert({ cache_key: CACHE_KEY, provider: "FantasyPros", payload, fetched_at: fetchedAt, expires_at: expiresAt, last_error: null, updated_at: fetchedAt }, { onConflict: "cache_key" }).select("cache_key").single());
    return { provider: "FantasyPros", payload, fetchedAt, expiresAt, source: "network", lastError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FantasyPros refresh failed";
    if (cache) {
      unwrap(await supabase.from("provider_cache").update({ last_error: message, updated_at: new Date().toISOString() }).eq("cache_key", CACHE_KEY).select("cache_key").single());
      return { ...snapshotFromCache(cache, "stale_cache"), lastError: message };
    }
    throw error;
  }
}
