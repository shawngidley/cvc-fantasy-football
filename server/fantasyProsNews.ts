// CVC and WRC used to share one FantasyPros API key with a 500 requests/day budget and
// both were hitting 429s. WRC now runs its own scheduled fetcher that stores every
// dataset in a table and exposes it at wrcfantasyfootball.com/api/fantasypros/feed.
// From here on CVC makes zero calls to api.fantasypros.com for news/injuries/rankings/
// projections -- it reads WRC's shared feed instead, keyed by the same cache-key
// strings WRC uses internally. The feed's payload for a given key is the raw
// FantasyPros JSON response body for that endpoint, unmodified, so every parsing
// function below is untouched -- only how the raw payload is fetched changed.
//
// (The three FantasyPros calls in fantasyProsCache.ts -- full player sync, rookie
// flags, active-player flags -- are commissioner-triggered, low-volume admin buttons,
// not the traffic-driven calls that caused the 429s, and were deliberately left calling
// api.fantasypros.com directly per commissioner decision.)
const FEED_BASE = "https://wrcfantasyfootball.com/api/fantasypros/feed";

// So one page load (which can trigger several of these calls, e.g. news + per-position
// ranks for enrichment) doesn't hit WRC's feed repeatedly for the same key.
const LOCAL_CACHE_TTL_MS = 5 * 60_000;

type CacheEntry<T> = { expiresAt: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

/** Fetches one WRC feed key, returning `null` (never throwing) on any failure --
 * missing secret, 401, 404 (key not populated yet), 5xx, timeout, or network error --
 * so a FantasyPros outage or a not-yet-warmed WRC key degrades to an empty dataset
 * instead of breaking the page. Never falls back to calling FantasyPros directly. */
async function requestFeed(key: string): Promise<unknown> {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;

  const secret = process.env.FANTASYPROS_FEED_SECRET;
  if (!secret) {
    console.warn(`[FantasyPros feed] FANTASYPROS_FEED_SECRET is not configured -- returning an empty result for key "${key}".`);
    return null;
  }

  try {
    const response = await fetch(`${FEED_BASE}?key=${encodeURIComponent(key)}`, {
      headers: { "x-feed-secret": secret },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`[FantasyPros feed] Request for key "${key}" failed with status ${response.status} -- returning an empty result.`);
      return null;
    }
    // The feed endpoint returns the whole cache row ({key, payload, fetched_at,
    // expires_at}), not the raw FantasyPros payload itself -- the actual data every
    // parser below expects (`.injuries`, `.items`, `.players`) lives one level down,
    // under `.payload`.
    const row = await response.json();
    const value = asRecord(row).payload ?? null;
    cache.set(key, { value, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn(`[FantasyPros feed] Request for key "${key}" threw -- returning an empty result.`, error instanceof Error ? error.message : error);
    return null;
  }
}

export type FantasyProsNewsItem = {
  id: number;
  playerId: number | null;
  playerName: string;
  team: string;
  position?: string;
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

export type FantasyProsInjury = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  status: string;
  shortStatus: string;
  injuryType: string;
  practiceInjuryType: string;
  comment: string;
  updated: string;
  probabilityOfPlaying: number | null;
  practices: string[];
};

export async function getFantasyProsInjuries(year: number, week: number): Promise<FantasyProsInjury[]> {
  const data = asRecord(await requestFeed(`injuries:${year}:week:${week}`));
  return asArray(data.injuries).map(item => {
    const row = asRecord(item);
    return {
      playerId: asNumber(row.player_id) ?? 0,
      name: asString(row.name),
      team: asString(row.team_id),
      position: asString(row.position_id),
      status: asString(row.status),
      shortStatus: asString(row.status_short),
      injuryType: asString(row.injury_type),
      practiceInjuryType: asString(row.practice_report_injury_type),
      comment: asString(row.comment),
      updated: asString(row.injury_update_date),
      probabilityOfPlaying: asNumber(row.probability_of_playing),
      practices: [asString(row.practice_1), asString(row.practice_2), asString(row.practice_3)].filter(Boolean),
    };
  }).filter(item => item.name && item.status);
}

export async function getFantasyProsNews(limit = 50): Promise<FantasyProsNewsItem[]> {
  // WRC's feed stores the whole news payload under one key with no limit/order_by
  // control -- apply the requested limit ourselves after fetching instead of as a
  // request parameter.
  const data = asRecord(await requestFeed("news"));
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
  return items.slice(0, Math.min(Math.max(limit, 1), 100));
}


export type FantasyProsRank = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  ecr: number | null;
  positionRank: string;
  tier: number | null;
  byeWeek: number | null;
};

/** WRC's feed keys ranks by position and week only (no year, no scoring/type
 * dimension -- always PPR/weekly in WRC's own stored payload) and has no "OP"
 * (cross-position overall) key at all, so that position always returns empty rather
 * than requesting a key that doesn't exist. `year` is accepted for signature
 * compatibility with existing callers but no longer used to build the request. */
export async function getFantasyProsRanks(year: number, position: string, week: number): Promise<FantasyProsRank[]> {
  if (position === "OP") return [];
  const data = asRecord(await requestFeed(`ranks:${position}:week:${week}`));
  return asArray(data.players).map(item => {
    const row = asRecord(item);
    return {
      playerId: asNumber(row.player_id) ?? 0,
      name: asString(row.player_name),
      team: asString(row.player_team_id),
      position: asString(row.player_position_id),
      ecr: asNumber(row.rank_ecr),
      positionRank: asString(row.pos_rank),
      tier: asNumber(row.tier),
      byeWeek: asNumber(row.player_bye_week),
    };
  }).filter(item => item.name);
}

export type FantasyProsProjection = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  points: number | null;
  pprPoints: number | null;
  passYards: number | null;
  passTouchdowns: number | null;
  interceptions: number | null;
  rushYards: number | null;
  rushTouchdowns: number | null;
};

// `year` is accepted for signature compatibility with existing callers but no longer
// used to build the request -- see getFantasyProsRanks above.
export async function getFantasyProsProjections(year: number, position: string, week: number): Promise<FantasyProsProjection[]> {
  const data = asRecord(await requestFeed(`projections:${position}:week:${week}`));
  return asArray(data.players).map(item => {
    const row = asRecord(item);
    // Confirmed live: row.stats is a plain object (e.g. {points, points_ppr,
    // pass_yds, ...}), not an array -- asArray(row.stats)[0] silently coerced it to
    // an empty object for every single player, so every parsed field was always null.
    const stats = asRecord(row.stats);
    return {
      playerId: asNumber(row.fpid) ?? 0,
      name: asString(row.name),
      team: asString(row.team_id),
      position: asString(row.position_id),
      points: asNumber(stats.points),
      pprPoints: asNumber(stats.points_ppr),
      passYards: asNumber(stats.pass_yds),
      passTouchdowns: asNumber(stats.pass_tds),
      interceptions: asNumber(stats.pass_ints),
      rushYards: asNumber(stats.rush_yds),
      rushTouchdowns: asNumber(stats.rush_tds),
    };
  }).filter(item => item.name);
}

/**
 * Finds which known CVC player (from candidates, sorted longest-name-first by the
 * caller to avoid a short name false-matching as a prefix of a longer one) a
 * FantasyPros news title starts with. Confirmed necessary: the raw /nfl/news response
 * has no player_name or name field at all -- the player's identity only exists
 * embedded in the title text (e.g. "De'Zhaun Stribling (ankle) out at least one
 * month"), so lookup-by-name-field never worked. Periods are stripped from both sides
 * before comparing, since a title can use "A.J. Brown" while CVC's own player record
 * stores "AJ Brown" (or vice versa).
 */
export function matchPlayerNameFromTitle<T extends { display_name: string }>(title: string, candidatesLongestFirst: T[]): T | undefined {
  const stripPeriods = (value: string) => value.replace(/\./g, "");
  const lowerTitle = stripPeriods(title.toLowerCase());
  for (const candidate of candidatesLongestFirst) {
    const name = stripPeriods(candidate.display_name.toLowerCase());
    if (!lowerTitle.startsWith(name)) continue;
    const next = lowerTitle.charAt(name.length);
    if (next === "" || next === " " || next === "(") return candidate;
  }
  return undefined;
}
