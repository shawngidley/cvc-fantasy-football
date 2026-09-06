import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CvcNewsItem } from "@/components/CvcNewsRow";

type TankNews = { title?: string; link?: string; image?: string; playerIDs?: string[] };
const CACHE_KEY = "cvc_tank01_news_v1";
const TTL_MS = 15 * 60_000;
const INJURY_KEYWORDS = ["injur", "questionable", "doubtful", " ruled out", "out for", " ir ", "surgery", "concussion", "hamstring", "ankle", "knee", "illness"];

// Same normalization used server-side (fantasyProsNews procedure in league.ts) and in
// CvcPlayerNews.tsx, kept in sync manually per the existing per-file-normalizer
// convention in this codebase rather than a shared import for one small function.
function normalizeName(name: string) {
  return name.toLowerCase().replace(/\./g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}

/** Fetches Tank01's news feed and maps each item to a CVC player record, exactly the
 * same way CvcPlayerNews.tsx's full News page already does: match on the item's own
 * Tank01 playerIDs against player.metadata.tank01_id first (reliable, structured),
 * falling back to a leading-name-before-a-verb heuristic against the headline text for
 * items with no tank01_id link yet. Returns every mapped item, unfiltered by roster --
 * callers filter down to their own player set. */
export function useTank01MappedNews(): { items: CvcNewsItem[]; loading: boolean; error: string; refresh: () => void } {
  const playerIndex = trpc.league.newsPlayerIndex.useQuery();
  const [tankItems, setTankItems] = useState<TankNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = (force = false) => {
    setLoading(true); setError("");
    (async () => {
      try {
        if (!force) {
          const cached = sessionStorage.getItem(CACHE_KEY);
          if (cached) { const parsed = JSON.parse(cached) as { ts: number; data: TankNews[] }; if (Date.now() - parsed.ts < TTL_MS) { setTankItems(parsed.data); setLoading(false); return; } }
        }
        const response = await fetch("/api/tank01/getNFLNews?recentNews=true");
        if (!response.ok) throw new Error("Tank01 news is unavailable");
        const payload = await response.json() as { body?: TankNews[] };
        const fresh = Array.isArray(payload.body) ? payload.body.filter(item => item.title) : [];
        setTankItems(fresh); sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: fresh }));
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Tank01 news is unavailable"); }
      finally { setLoading(false); }
    })();
  };
  useEffect(() => { load(); }, []);

  const playerByName = useMemo(() => new Map((playerIndex.data ?? []).map(row => [normalizeName(row.display_name), row])), [playerIndex.data]);
  const playerByTank01Id = useMemo(() => {
    const map = new Map<string, NonNullable<typeof playerIndex.data>[number]>();
    for (const row of playerIndex.data ?? []) {
      const id = (row.metadata as Record<string, unknown> | null)?.tank01_id;
      if (id != null) map.set(String(id), row);
    }
    return map;
  }, [playerIndex.data]);

  const items = useMemo<CvcNewsItem[]>(() => {
    return tankItems.map(item => {
      const title = item.title ?? "";
      const byId = item.playerIDs?.map(id => playerByTank01Id.get(String(id))).find(Boolean);
      let player = byId;
      if (!player) {
        const cleaned = title.replace(/\s*\([^)]*\)/g, "").trim();
        const verbs = "is|to|week|primed|signing|signs|released|waived|misses|suffers|works|returns|dealing|placed|goes|not|will|plays|starts|exits|practices|participated|expected|day|activated|traded|cut|restructures|agrees|clears|questionable|doubtful|out|ruled|active|inactive|elevated|promoted|demoted|extends|tears|fractures|sprains|avoids|undergoes|has|had|remains|continues";
        const match = cleaned.match(new RegExp(`^([A-Z][A-Za-z.'-]*(?:\\s+(?:[A-Z][A-Za-z.'-]*|Jr\\.?|Sr\\.?|II|III)){1,3})(?=\\s+(?:${verbs})\\b)`));
        const inferredName = match?.[1] ?? "";
        player = inferredName ? playerByName.get(normalizeName(inferredName)) : undefined;
      }
      if (!player) return null as CvcNewsItem | null;
      const text = title.toLowerCase();
      const mapped: CvcNewsItem = {
        playerName: player.display_name, pos: player.position ?? "", nflTeam: player.nfl_team ?? "",
        headline: title, published: new Date().toISOString(), url: item.link,
        isInjury: INJURY_KEYWORDS.some(keyword => text.includes(keyword)),
        source: "Tank01", playerId: player.id,
      };
      return mapped;
    }).filter((item): item is CvcNewsItem => item !== null);
  }, [tankItems, playerByName, playerByTank01Id]);

  return { items, loading: loading || playerIndex.isLoading, error, refresh: () => load(true) };
}
