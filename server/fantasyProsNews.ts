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

async function fetchLive(limit: number): Promise<{ items: FantasyProsNewsItem[]; debugRawKeys: string[]; debugRawSample: string }> {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) throw new Error("FantasyPros is not configured for CVC.");
  await waitForRequestWindow();
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)), order_by: "updated" });
  const response = await fetch(`https://api.fantasypros.com/public/v2/json/nfl/news?${query.toString()}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FantasyPros news request failed with status ${response.status}`);
  const raw = await response.json();
  const data = asRecord(raw);
  const items = asArray(data.items).map(item => {
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
  return { items, debugRawKeys: Object.keys(data), debugRawSample: JSON.stringify(raw).slice(0, 2000) };
}

/** Same cache/fallback shape as getFantasyProsPlayerSnapshot in fantasyProsCache.ts: serve
 * fresh cache when available, otherwise fetch live and cache the result, and on a failed
 * live fetch fall back to serving stale cache (with lastError recorded) rather than a hard
 * error, so a transient FantasyPros outage doesn't blank the News page for CVC owners. */
export async function getFantasyProsNews(limit = 100): Promise<{ items: FantasyProsNewsItem[]; source: "cache" | "network" | "stale_cache"; debug?: { rawKeys: string[]; rawSample: string } }> {
  const cacheRow = unwrap(await supabase.from("provider_cache").select("payload, fetched_at, expires_at, last_error").eq("cache_key", CACHE_KEY).maybeSingle());
  const now = Date.now();
  if (cacheRow && new Date(cacheRow.expires_at).getTime() > now) {
    return { items: (cacheRow.payload as FantasyProsNewsItem[] | null) ?? [], source: "cache" };
  }
  try {
    const { items, debugRawKeys, debugRawSample } = await fetchLive(limit);
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();
    unwrap(await supabase.from("provider_cache").upsert({ cache_key: CACHE_KEY, provider: "FantasyPros", payload: items, fetched_at: fetchedAt, expires_at: expiresAt, last_error: null, updated_at: fetchedAt }, { onConflict: "cache_key" }).select("cache_key").single());
    // TEMP DIAGNOSTIC: only attached when the live fetch produced zero items, so we can
    // see the real FantasyPros /nfl/news response shape without guessing further. Remove
    // once the shape is confirmed and the parser (if needed) is fixed to match it.
    return items.length ? { items, source: "network" } : { items, source: "network", debug: { rawKeys: debugRawKeys, rawSample: debugRawSample } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FantasyPros news request failed";
    if (cacheRow) {
      unwrap(await supabase.from("provider_cache").update({ last_error: message, updated_at: new Date().toISOString() }).eq("cache_key", CACHE_KEY).select("cache_key").single());
      return { items: (cacheRow.payload as FantasyProsNewsItem[] | null) ?? [], source: "stale_cache" };
    }
    throw error;
  }
}
