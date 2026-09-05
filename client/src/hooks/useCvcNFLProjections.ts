import { useEffect, useState } from "react";
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
  return {
    Passing: { passYds: n(passing.passYds), passTD: n(passing.passTD), int: n(passing.int) },
    Rushing: { rushYds: n(rushing.rushYds), rushTD: n(rushing.rushTD) },
    Receiving: { recYds: n(receiving.recYds), recTD: n(receiving.recTD), receptions: n(receiving.receptions) },
    Kicking: { xpMade: n(kicking.xpMade) },
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
export function useCvcNFLProjections(week: number | undefined, season: number, rules: CvcScoringRule[]): { projections: CvcProjectionMap; loading: boolean } {
  const [projections, setProjections] = useState<CvcProjectionMap>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!week || !rules.length) return;
    const cacheKey = `${CACHE_PREFIX}${season}_w${week}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) { setProjections(JSON.parse(cached) as CvcProjectionMap); return; }
    } catch { /* ignore */ }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/tank01/getNFLProjections?week=${week}&season=${season}&seasonType=Regular%20Season`)
      .then(response => (response.ok ? response.json() : null) as Promise<{ body?: Record<string, unknown> } | null>)
      .then(data => {
        const body = data?.body ?? {};
        const map: CvcProjectionMap = {};
        const playerProjections = (body.playerProjections as Record<string, unknown>) ?? {};
        for (const row of Object.values(playerProjections) as Record<string, unknown>[]) {
          const name = String(row.longName ?? "");
          if (!name) continue;
          const pos = String(row.pos ?? "");
          const team = String(row.team ?? "");
          const proj = calculateCvcFantasyPoints(toPlayerStatsShape(row), pos, rules);
          const entry: CvcProjectionEntry = { proj: Math.max(0, Math.round(proj * 10) / 10), pos, team };
          map[name.toLowerCase()] = entry;
          map[normalizeProjectionName(name)] = entry;
        }
        const dstProjections = (body.teamDefenseProjections as Record<string, unknown>) ?? {};
        for (const row of Object.values(dstProjections) as Record<string, unknown>[]) {
          const rawAbv = String(row.teamAbv ?? "");
          if (!rawAbv) continue;
          const abv = normalizeAbv(rawAbv);
          const proj = calculateCvcFantasyPoints(toDstStatsShape(row), "DST", rules);
          map[`dst:${abv}`] = { proj: Math.max(0, Math.round(proj * 10) / 10), pos: "DST", team: abv };
        }
        if (!cancelled) {
          setProjections(map);
          try { sessionStorage.setItem(cacheKey, JSON.stringify(map)); } catch { /* ignore */ }
        }
      })
      .catch(() => { if (!cancelled) setProjections({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [week, season, rules.length]);

  return { projections, loading };
}

export function getCvcProjectedPoints(projections: CvcProjectionMap, playerName: string, position: string | null | undefined, nflTeam: string | null | undefined): number | null {
  if ((position ?? "").toUpperCase() === "DST" || (position ?? "").toUpperCase() === "DEF") {
    return projections[`dst:${normalizeAbv(nflTeam ?? "")}`]?.proj ?? null;
  }
  return projections[playerName.toLowerCase()]?.proj ?? projections[normalizeProjectionName(playerName)]?.proj ?? null;
}
