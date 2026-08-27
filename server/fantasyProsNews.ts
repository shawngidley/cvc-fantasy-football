// Ported directly from WRC's server/fantasypros.ts getFantasyProsNews, which is
// confirmed working in production there -- simple in-memory cache, no Supabase table
// involved at all. Replaces an earlier provider_cache-table-based version here that hit
// an unexplained bug: direct SQL repeatedly confirmed the cached row held real, valid,
// non-expired data, yet the read path in this same code kept computing zero items from
// it, across every fix attempted (payload shape tolerance, POST vs GET, method-override
// server config). Rather than keep chasing that, use the exact mechanism already proven
// to work for this exact problem in WRC.
const API_BASE = "https://api.fantasypros.com/public/v2/json";

type CacheEntry<T> = { expiresAt: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

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

async function request<T>(path: string, cacheTtlMs: number): Promise<T> {
  const existing = cache.get(path) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) return existing.value;

  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) throw new Error("FantasyPros is not configured for CVC.");

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`FantasyPros request failed with status ${response.status}`);

  const value = (await response.json()) as T;
  cache.set(path, { value, expiresAt: Date.now() + cacheTtlMs });
  return value;
}

export async function getFantasyProsNews(limit = 50): Promise<FantasyProsNewsItem[]> {
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)), order_by: "updated" });
  const data = asRecord(await request<unknown>(`/nfl/news?${query.toString()}`, 15 * 60_000));
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
