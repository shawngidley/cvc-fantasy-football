import { useEffect, useState } from "react";
import type { Tank01LiveStats } from "@shared/cvcScoring";

export type Tank01Profile = { espnHeadshot?: string; age?: string; stats?: Tank01LiveStats & { gamesPlayed?: string | number } };
export type ProfileLookupPlayer = { display_name: string; metadata?: { tank01_id?: unknown } | null };

type CacheEntry = { value: Tank01Profile | null; expiresAt: number };

// In-memory L1 cache (fastest path within a session) backed by localStorage as an L2
// cache. localStorage (not sessionStorage): shared across every tab on this browser,
// not scoped to one tab -- confirmed in WRC's equivalent fix that a session/reload-
// scoped cache meant every fresh tab or reload re-fetched every visible player from
// scratch even when the exact same players had just been looked up moments earlier
// elsewhere on the same browser.
//
// 24h TTL (was 12h, in-memory only): basic player info -- name, team, headshot, age --
// doesn't meaningfully change within a day, matching the TTL WRC settled on for the
// same data.
const profileCache = new Map<string, CacheEntry>();
export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "cvc_tank01_profile_";

export function readPersistedProfile(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null; // localStorage unavailable (e.g. private browsing, or a non-DOM test environment) -- fall through to fetching
  }
}

export function persistProfile(key: string, entry: CacheEntry) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable -- the in-memory cache above still works for this session
  }
}

export const profileKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

// Concurrency limiter for getNFLPlayerInfo requests, ported from WRC's confirmed fix
// (client/src/hooks/useTank01Player.ts, acquirePlayerInfoSlot/releasePlayerInfoSlot).
// CVC's page-level hook (below) already batches all of a page's players into one
// call rather than one independent fetch per avatar component like WRC's PlayerAvatar
// -- but that batch was still resolved with a fully sequential for-await loop, one
// player at a time, which meant a full Live Scoring page (30+ players, each a
// 3.3-3.8s Tank01 response when uncached) could take well over a minute to finish
// loading everyone. Switching the batch to run in parallel needs the same kind of cap
// WRC added, so that parallelism doesn't reintroduce WRC's original problem: a burst
// of 30+ simultaneous requests that Tank01 appears to throttle under (the same
// 3.3-3.8s vs ~150ms slowdown WRC confirmed via Tank01's own API dashboard).
//
// Wraps only the network call itself, not the cache check or the ID-then-name
// fallback as a whole -- wrapping the whole function would let an outer call hold its
// slot while awaiting its own inner call for a second slot, risking a deadlock once
// every slot ends up held by calls all waiting on each other.
const MAX_CONCURRENT_PLAYER_INFO_REQUESTS = 5;
let activePlayerInfoRequests = 0;
const playerInfoWaitQueue: Array<() => void> = [];

export async function acquirePlayerInfoSlot(): Promise<void> {
  if (activePlayerInfoRequests < MAX_CONCURRENT_PLAYER_INFO_REQUESTS) {
    activePlayerInfoRequests++;
    return;
  }
  return new Promise<void>(resolve => playerInfoWaitQueue.push(resolve));
}

export function releasePlayerInfoSlot(): void {
  activePlayerInfoRequests--;
  const next = playerInfoWaitQueue.shift();
  if (next) {
    activePlayerInfoRequests++;
    next();
  }
}

/** Fetches a single player's Tank01 profile: an exact ID lookup first when a Tank01 ID
 * is already confirmed via player.metadata.tank01_id, falling back to a name search --
 * confirmed in tank01SeasonStatsSync.ts's server-side sync that the name search fails
 * systematically for some real players/team defenses even when the ID lookup
 * succeeds. Each network call acquires its own concurrency slot around just that
 * call, not the whole function, so the ID lookup releases its slot before the
 * name-search fallback (if needed) requests its own.
 */
async function fetchTank01Profile(player: ProfileLookupPlayer): Promise<Tank01Profile | null> {
  const tank01Id = player.metadata?.tank01_id ? String(player.metadata.tank01_id) : null;
  let value: Tank01Profile | null = null;
  if (tank01Id) {
    await acquirePlayerInfoSlot();
    try {
      const byIdResponse = await fetch(`/api/tank01/getNFLPlayerInfo?playerID=${encodeURIComponent(tank01Id)}&getStats=true`);
      const byIdPayload = await byIdResponse.json() as { body?: Tank01Profile | Tank01Profile[] };
      value = (Array.isArray(byIdPayload.body) ? byIdPayload.body[0] : byIdPayload.body) ?? null;
    } catch {
      value = null;
    } finally {
      releasePlayerInfoSlot();
    }
  }
  if (!value) {
    await acquirePlayerInfoSlot();
    try {
      const response = await fetch(`/api/tank01/getNFLPlayerInfo?playerName=${encodeURIComponent(player.display_name)}&getStats=true`);
      const payload = await response.json() as { body?: Tank01Profile[] };
      value = payload.body?.[0] ?? null;
    } catch {
      value = null;
    } finally {
      releasePlayerInfoSlot();
    }
  }
  return value;
}

/** Fetches Tank01 player profiles (headshot, age, live stats) for a list of players,
 * deduplicated and cached (in-memory, backed by localStorage). Capped at 22 distinct
 * players per call (a full roster) by default; pass a higher limit for pages needing
 * more (e.g. Live Scoring's full matchup). Cache hits are applied immediately without
 * waiting on the concurrency limiter; only actual network fetches queue for a slot. */
export function useCvcTank01PlayerProfiles(players: ProfileLookupPlayer[], limit = 22) {
  const signature = players.map(player => player.display_name.trim()).sort().join("|");
  const [profiles, setProfiles] = useState<Record<string, Tank01Profile | null>>({});

  useEffect(() => {
    let active = true;
    const targets = Array.from(new Map<string, ProfileLookupPlayer>(players.filter(player => player.display_name.trim()).map(player => [profileKey(player.display_name), player])).values()).slice(0, limit);

    const load = async () => {
      const toFetch: ProfileLookupPlayer[] = [];
      const fromCache: Record<string, Tank01Profile | null> = {};
      for (const player of targets) {
        const key = profileKey(player.display_name);
        let cached = profileCache.get(key);
        if (!cached || cached.expiresAt <= Date.now()) {
          const persisted = readPersistedProfile(key);
          if (persisted) { cached = persisted; profileCache.set(key, persisted); }
        }
        if (cached && cached.expiresAt > Date.now()) fromCache[key] = cached.value;
        else toFetch.push(player);
      }
      if (active && Object.keys(fromCache).length) setProfiles(current => ({ ...current, ...fromCache }));

      await Promise.all(toFetch.map(async player => {
        const key = profileKey(player.display_name);
        let value: Tank01Profile | null;
        try {
          value = await fetchTank01Profile(player);
        } catch {
          value = null;
        }
        // Only persist real hits to localStorage -- a transient failure shouldn't
        // poison the cross-tab, multi-hour persistent cache the way a short in-memory-
        // only failure cache safely can.
        const entry: CacheEntry = { value, expiresAt: Date.now() + (value ? PROFILE_TTL_MS : 10 * 60 * 1000) };
        profileCache.set(key, entry);
        if (value) persistProfile(key, entry);
        if (active) setProfiles(current => ({ ...current, [key]: value }));
      }));
    };
    if (targets.length) void load(); else setProfiles({});
    return () => { active = false; };
  }, [signature]);

  return profiles;
}
