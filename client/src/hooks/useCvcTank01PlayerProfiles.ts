import { useEffect, useState } from "react";
import type { Tank01LiveStats } from "@shared/cvcScoring";

export type Tank01Profile = { espnHeadshot?: string; age?: string; stats?: Tank01LiveStats & { gamesPlayed?: string | number } };
export type ProfileLookupPlayer = { display_name: string; metadata?: { tank01_id?: unknown } | null };

const profileCache = new Map<string, { value: Tank01Profile | null; expiresAt: number }>();
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;
export const profileKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fetches Tank01 player profiles (headshot, age, live stats) for a list of players,
 * deduplicated and cached. Same preference order as tank01SeasonStatsSync.ts's
 * server-side sync: an exact ID lookup first when a Tank01 ID is already confirmed via
 * player.metadata.tank01_id, falling back to a name search -- confirmed there that the
 * name search fails systematically for some real players/team defenses even when the
 * ID lookup succeeds. Capped at 22 distinct players per call (a full roster); pass a
 * pre-deduplicated list for pages needing more (e.g. Live Scoring's full matchup). */
export function useCvcTank01PlayerProfiles(players: ProfileLookupPlayer[], limit = 22) {
  const signature = players.map(player => player.display_name.trim()).sort().join("|");
  const [profiles, setProfiles] = useState<Record<string, Tank01Profile | null>>({});

  useEffect(() => {
    let active = true;
    const targets = Array.from(new Map<string, ProfileLookupPlayer>(players.filter(player => player.display_name.trim()).map(player => [profileKey(player.display_name), player])).values()).slice(0, limit);
    const load = async () => {
      const next: Record<string, Tank01Profile | null> = {};
      for (const player of targets) {
        const key = profileKey(player.display_name);
        const cached = profileCache.get(key);
        if (cached && cached.expiresAt > Date.now()) { next[key] = cached.value; continue; }
        try {
          const tank01Id = player.metadata?.tank01_id ? String(player.metadata.tank01_id) : null;
          let value: Tank01Profile | null = null;
          if (tank01Id) {
            const byIdResponse = await fetch(`/api/tank01/getNFLPlayerInfo?playerID=${encodeURIComponent(tank01Id)}&getStats=true`);
            const byIdPayload = await byIdResponse.json() as { body?: Tank01Profile | Tank01Profile[] };
            value = (Array.isArray(byIdPayload.body) ? byIdPayload.body[0] : byIdPayload.body) ?? null;
          }
          if (!value) {
            const response = await fetch(`/api/tank01/getNFLPlayerInfo?playerName=${encodeURIComponent(player.display_name)}&getStats=true`);
            const payload = await response.json() as { body?: Tank01Profile[] };
            value = payload.body?.[0] ?? null;
          }
          profileCache.set(key, { value, expiresAt: Date.now() + PROFILE_TTL_MS });
          next[key] = value;
        } catch { profileCache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 }); next[key] = null; }
        if (active) setProfiles(current => ({ ...current, ...next }));
      }
      if (active) setProfiles(current => ({ ...current, ...next }));
    };
    if (targets.length) void load(); else setProfiles({});
    return () => { active = false; };
  }, [signature]);

  return profiles;
}
