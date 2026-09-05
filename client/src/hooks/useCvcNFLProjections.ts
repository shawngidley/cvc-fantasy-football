import { useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

const CACHE_PREFIX = "cvc_nfl_proj_v1_";
const TEAM_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };

function normalizeAbv(abv: string): string {
  const lower = abv.toLowerCase();
  return (TEAM_ALIASES[lower] ?? lower).toUpperCase();
}

/** Same suffix-stripping used elsewhere in this codebase (normalizePlayerName), applied
 * locally so this hook has no server dependency -- it's a pure client-side fetch,
 * matching WRC's exact architecture for this feature. */
function normalizeProjectionName(name: string): string {
  return name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "").replace(/[^a-z0-9]/g, "");
}

function n(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPlayerStatsShape(row: Record<string, unknown>): Tank01LiveStats {
  const passing = (row.Passing as Record<string, unknown>) ?? {};
  const rushing = (row.Rushing as Record<string, unknown>) ?? {};
  const receiving = (row.Receiving as Record<string, unknown>) ?? {};
  const kicking = (row.Kicking as Record<string, unknown>) ?? {};
  // Tank01's projections endpoint doesn't project a field goal's actual distance, only
  // a projected made-count -- unlike completed games, which do report real yardage.
  // Confirmed by WRC's own identical workaround (same 38-yard average assumption) in
  // its useNFLProjections.ts. CVC's field_goal_yard rule needs *some* yardage figure to
  // produce a non-zero kicker projection, so estimate it the same way when the real
  // field is absent (present-but-zero is trusted as-is, not overridden).
  const realFgYds = kicking.fgYds ?? kicking.kickYards;
  const estimatedFgYds = realFgYds !== undefined ? n(realFgYds) : n(kicking.fgMade) * 38;
  return {
    Passing: { passYds: n(passing.passYds), passTD: n(passing.passTD), int: n(passing.int) },
    Rushing: { rushYds: n(rushing.rushYds), rushTD: n(rushing.rushTD) },
    Receiving: { recYds: n(receiving.recYds), recTD: n(receiving.recTD), receptions: n(receiving.receptions) },
    Kicking: { xpMade: n(kicking.xpMade), fgYds: estimatedFgYds },
    Defense: { sacks: 0, defensiveInterceptions: 0, defTD: 0, fumblesRecovered: 0 },
  };
}

/** Tank01's team-defense projection field names (sacks/interceptions/fumbleRecoveries/
 * defTD/returnTD) differ from calculateCvcFantasyPoints' Defense shape
 * (sacks/defensiveInterceptions/fumblesRecovered/defTD) -- mapped explicitly here.
 * returnTD is folded into defTD since CVC's scoring has no separate return-TD rule. */
function toDstStatsShape(row: Record<string, unknown>): Tank01LiveStats {
  return {
    Passing: { passYds: 0, passTD: 0, int: 0 },
    Rushing: { rushYds: 0, rushTD: 0 },
    Receiving: { recYds: 0, recTD: 0, receptions: 0 },
    Kicking: { xpMade: 0 },
    Defense: { sacks: n(row.sacks), defensiveInterceptions: n(row.interceptions), defTD: n(row.defTD) + n(row.returnTD), fumblesRecovered: n(row.fumbleRecoveries) },
  };
}

export type CvcProjectionEntry = { proj: number; pos: string; team: string };
export type CvcProjectionMap = Record<string, CvcProjectionEntry>;

/** Fetches Tank01's weekly fantasy projections (raw stat projections, not points) for
 * every NFL player and team defense, and scores them with CVC's own rules -- so
 * "Projected" reflects this league's actual scoring, not Tank01's own generic point
 * estimate or WRC's formula. Cached in sessionStorage per week/season, matching WRC. */
export function useCvcNFLProjections(week: number | undefined, season: number, rules: CvcScoringRule[]): { projections: CvcProjectionMap; loading: boolean; debug: { url: string | null; status: number | null; error: string | null; rawBody: unknown; playerCount: number; dstCount: number; sampleKickerRow: unknown; kickerProjections: { name: string; pos: string; proj: number }[]; bodyKeys: string[] } } {
  const [projections, setProjections] = useState<CvcProjectionMap>({});
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState<{ url: string | null; status: number | null; error: string | null; rawBody: unknown; playerCount: number; dstCount: number; sampleKickerRow: unknown; kickerProjections: { name: string; pos: string; proj: number }[]; bodyKeys: string[] }>({ url: null, status: null, error: null, rawBody: null, playerCount: 0, dstCount: 0, sampleKickerRow: null, kickerProjections: [], bodyKeys: [] });

  const runCount = useRef(0);

  useEffect(() => {
    runCount.current += 1;
    if (!week || !rules.length) { setDebug(current => ({ ...current, error: `Effect bailed (run #${runCount.current}): week=${JSON.stringify(week)}, rulesLength=${rules.length}, season=${season}` })); return; }
    const cacheKey = `${CACHE_PREFIX}${season}_w${week}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as CvcProjectionMap;
        if (Object.keys(parsed).length > 0) { setProjections(parsed); return; }
      }
    } catch { /* ignore */ }

    let cancelled = false;
    setLoading(true);
    setDebug(current => ({ ...current, error: `Fetching (run #${runCount.current}): week=${week}, rulesLength=${rules.length}` }));
    const url = `/api/tank01/getNFLProjections?week=${week}&season=${season}&seasonType=Regular%20Season`;
    fetch(url)
      .then(response => {
        if (!cancelled) setDebug(current => ({ ...current, url, status: response.status }));
        return (response.ok ? response.json() : response.json().catch(() => null)) as Promise<{ body?: Record<string, unknown>; error?: string } | null>;
      })
      .then(data => {
        if (!cancelled) setDebug(current => ({ ...current, rawBody: data, error: data?.error ?? null, bodyKeys: data?.body ? Object.keys(data.body) : [] }));
        const body = data?.body ?? {};
        const map: CvcProjectionMap = {};
        const playerProjections = (body.playerProjections as Record<string, unknown>) ?? {};
        const playerRows = Object.values(playerProjections) as Record<string, unknown>[];
        let sampleKickerRow: unknown = null;
        const kickerProjections: { name: string; pos: string; proj: number }[] = [];
        for (const row of playerRows) {
          const name = String(row.longName ?? "");
          if (!name) continue;
          const rawPos = String(row.pos ?? "");
          const pos = rawPos.toUpperCase() === "PK" ? "K" : rawPos;
          const team = String(row.team ?? "");
          const proj = calculateCvcFantasyPoints(toPlayerStatsShape(row), pos, rules);
          const entry: CvcProjectionEntry = { proj: Math.max(0, Math.round(proj * 10) / 10), pos, team };
          map[name.toLowerCase()] = entry;
          map[normalizeProjectionName(name)] = entry;
          if (pos === "K") {
            if (!sampleKickerRow) sampleKickerRow = row;
            kickerProjections.push({ name, pos: rawPos, proj: entry.proj });
          }
        }
        if (!cancelled) setDebug(current => ({ ...current, sampleKickerRow, kickerProjections }));
        const dstProjections = (body.teamDefenseProjections as Record<string, unknown>) ?? {};
        const dstRows = Object.values(dstProjections) as Record<string, unknown>[];
        for (const row of dstRows) {
          const rawAbv = String(row.teamAbv ?? "");
          if (!rawAbv) continue;
          const abv = normalizeAbv(rawAbv);
          const proj = calculateCvcFantasyPoints(toDstStatsShape(row), "DST", rules);
          map[`dst:${abv}`] = { proj: Math.max(0, Math.round(proj * 10) / 10), pos: "DST", team: abv };
        }
        if (!cancelled) {
          setProjections(map);
          setDebug(current => ({ ...current, playerCount: playerRows.length, dstCount: dstRows.length }));
          try { sessionStorage.setItem(cacheKey, JSON.stringify(map)); } catch { /* ignore */ }
        }
      })
      .catch(error => { if (!cancelled) { setProjections({}); setDebug(current => ({ ...current, error: error instanceof Error ? error.message : String(error) })); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [week, season, rules.length]);

  return { projections, loading, debug };
}

export function getCvcProjectedPoints(projections: CvcProjectionMap, playerName: string, position: string | null | undefined, nflTeam: string | null | undefined): number | null {
  if ((position ?? "").toUpperCase() === "DST" || (position ?? "").toUpperCase() === "DEF") {
    return projections[`dst:${normalizeAbv(nflTeam ?? "")}`]?.proj ?? null;
  }
  return projections[playerName.toLowerCase()]?.proj ?? projections[normalizeProjectionName(playerName)]?.proj ?? null;
}
