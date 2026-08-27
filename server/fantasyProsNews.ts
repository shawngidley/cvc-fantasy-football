import { supabase, unwrap } from "./supabase";
import { waitForRequestWindow } from "./fantasyProsCache";

const CACHE_KEY = "fantasypros:nfl:news:v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

export type FantasyProsNewsItem = {
  id: number;
  playerId: number | null;
  playerName: string;
  team: string;
  title: string;
  description: string;
  impact: string;
  author: string;
  published: string;
  link: string;
};

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function asString(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function asNumber(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

async function fetchLive(limit: number): Promise<FantasyProsNewsItem[]> {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) throw new Error("FantasyPros is not configured for CVC.");
  await waitForRequestWindow();
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)), order_by: "updated" });
  const response = await fetch(`https://api.fantasypros.com/public/v2/json/nfl/news?${query.toString()}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FantasyPros news request failed with status ${response.status}`);
  const data = asRecord(await response.json());
  return asArray(data.items).map(item => {
    const row = asRecord(item);
    return {
      id: asNumber(row.id) ?? 0,
      playerId: asNumber(row.player_id),
      playerName: asString(row.player_name ?? row.name),
      team: asString(row.team_id),
      title: asString(row.title),
      description: asString(row.desc),
      impact: asString(row.impact),
      author: asString(row.author),
      published: asString(row.created),
      link: asString(row.link),
    };
  }).filter(item => item.title);
}

/** Same cache/fallback shape as getFantasyProsPlayerSnapshot in fantasyProsCache.ts: serve
 * fresh cache when available, otherwise fetch live and cache the result, and on a failed
 * live fetch fall back to serving stale cache (with lastError recorded) rather than a hard
 * error, so a transient FantasyPros outage doesn't blank the News page for CVC owners. */
export async function getFantasyProsNews(limit = 100): Promise<{ items: FantasyProsNewsItem[]; source: "cache" | "network" | "stale_cache" }> {
  const cacheRow = unwrap(await supabase.from("provider_cache").select("payload, fetched_at, expires_at, last_error").eq("cache_key", CACHE_KEY).maybeSingle());
  const now = Date.now();
  const cachedItems = (row: typeof cacheRow) => {
    if (!row) return [];
    const cached = row.payload as FantasyProsNewsItem[] | { items: FantasyProsNewsItem[] } | null;
    return Array.isArray(cached) ? cached : cached?.items ?? [];
  };
  if (cacheRow && new Date(cacheRow.expires_at).getTime() > now) {
    return { items: cachedItems(cacheRow), source: "cache" };
  }
  try {
    const items = await fetchLive(limit);
    const existing = cachedItems(cacheRow);
    // Vercel serverless functions don't share module-level state (the rate limiter in
    // fantasyProsCache.ts) across concurrent instances, so simultaneous requests can
    // still hit FantasyPros' real rate limit -- which came back as a 200 OK with a
    // genuinely empty items array, not a distinguishable error (confirmed live: good
    // 80-item cached data got silently overwritten with []). If a live fetch comes back
    // empty while we're already holding real cached items, treat it as suspicious rather
    // than authoritative: keep serving the existing items and only refresh the cache's
    // expiry, instead of overwriting good data with a likely-throttled empty response.
    if (items.length === 0 && existing.length > 0) {
      const fetchedAt = new Date().toISOString();
      const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();
      unwrap(await supabase.from("provider_cache").update({ fetched_at: fetchedAt, expires_at: expiresAt, last_error: "Live fetch returned zero items while cache held real data -- likely rate-limited; kept serving existing cache.", updated_at: fetchedAt }).eq("cache_key", CACHE_KEY).select("cache_key").single());
      return { items: existing, source: "stale_cache" };
    }
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();
    unwrap(await supabase.from("provider_cache").upsert({ cache_key: CACHE_KEY, provider: "FantasyPros", payload: items, fetched_at: fetchedAt, expires_at: expiresAt, last_error: null, updated_at: fetchedAt }, { onConflict: "cache_key" }).select("cache_key").single());
    return { items, source: "network" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FantasyPros news request failed";
    if (cacheRow) {
      unwrap(await supabase.from("provider_cache").update({ last_error: message, updated_at: new Date().toISOString() }).eq("cache_key", CACHE_KEY).select("cache_key").single());
      return { items: cachedItems(cacheRow), source: "stale_cache" };
    }
    throw error;
  }
}
