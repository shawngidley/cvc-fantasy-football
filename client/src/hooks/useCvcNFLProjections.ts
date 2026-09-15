import { useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { normalizePlayerName } from "@shared/playerNameMatch";

// v3: bumped from v2 when CvcProjectionEntry's shape changed from a pre-computed
// `proj: number` to a raw `stats: Tank01LiveStats` (points are now computed lazily
// using the roster's own position, not baked in at fetch time -- see
// getCvcProjectedPoints below). A stale v2-cached entry has no .stats at all, so
// reading it crashed every consumer of getCvcProjectedPoints with "Cannot read
// properties of undefined (reading 'Passing')" the moment it tried to score it.
const CACHE_PREFIX = "cvc_nfl_proj_v3_";
const TEAM_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };

function normalizeAbv(abv: string): string {
  const lower = abv.toLowerCase();
  return (TEAM_ALIASES[lower] ?? lower).toUpperCase();
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

export type CvcProjectionEntry = { stats: Tank01LiveStats; pos: string; team: string };
export type CvcProjectionMap = Record<string, CvcProjectionEntry>;

/** Fetches Tank01's weekly fantasy projections (raw stat projections, not points) for
 * every NFL player and team defense, and scores them with CVC's own rules -- so
 * "Projected" reflects this league's actual scoring, not Tank01's own generic point
 * estimate or WRC's formula. Cached in sessionStorage per week/season, matching WRC. */
export function useCvcNFLProjections(week: number | undefined, season: number, rules: CvcScoringRule[]): { projections: CvcProjectionMap; loading: boolean; debug: { url: string | null; status: number | null; error: string | null; rawBody: unknown; playerCount: number; dstCount: number; sampleKickerRow: unknown; kickerProjections: { name: string; pos: string; proj: number }[]; bodyKeys: string[] }; retryNow: () => void } {
  const [projections, setProjections] = useState<CvcProjectionMap>({});
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState<{ url: string | null; status: number | null; error: string | null; rawBody: unknown; playerCount: number; dstCount: number; sampleKickerRow: unknown; kickerProjections: { name: string; pos: string; proj: number }[]; bodyKeys: string[] }>({ url: null, status: null, error: null, rawBody: null, playerCount: 0, dstCount: 0, sampleKickerRow: null, kickerProjections: [], bodyKeys: [] });

  const runCount = useRef(0);
  // Kept as refs so retryNow (a stable function identity, safe to call from a click
  // handler at any time) always reads the *current* week/rules, not whatever values
  // were captured in an earlier closure.
  const latestWeek = useRef(week);
  const latestSeason = useRef(season);
  const latestRules = useRef(rules);
  latestWeek.current = week;
  latestSeason.current = season;
  latestRules.current = rules;

  const runFetch = (source: string) => {
    const currentWeek = latestWeek.current;
    const currentSeason = latestSeason.current;
    const currentRules = latestRules.current;
    runCount.current += 1;
    if (!currentWeek || !currentRules.length) { setDebug(current => ({ ...current, error: `${source} bailed (run #${runCount.current}): week=${JSON.stringify(currentWeek)}, rulesLength=${currentRules.length}, season=${currentSeason}` })); return; }

    let cancelled = false;
    setLoading(true);
    setDebug(current => ({ ...current, error: `Fetching (${source}, run #${runCount.current}): week=${currentWeek}, rulesLength=${currentRules.length}` }));
    const url = `/api/tank01/getNFLProjections?week=${currentWeek}&season=${currentSeason}&seasonType=Regular%20Season`;
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
          const stats = toPlayerStatsShape(row);
          const entry: CvcProjectionEntry = { stats, pos, team };
          map[name.toLowerCase()] = entry;
          map[normalizePlayerName(name)] = entry;
          if (pos === "K") {
            if (!sampleKickerRow) sampleKickerRow = row;
            // Debug-only estimate using Tank01's own (not necessarily reliable) rawPos
            // -- doesn't affect any real scoring, which now always uses the roster's
            // own known position instead (see getCvcProjectedPoints below).
            kickerProjections.push({ name, pos: rawPos, proj: Math.max(0, Math.round(calculateCvcFantasyPoints(stats, pos, currentRules) * 10) / 10) });
          }
        }
        if (!cancelled) setDebug(current => ({ ...current, sampleKickerRow, kickerProjections }));
        const dstProjections = (body.teamDefenseProjections as Record<string, unknown>) ?? {};
        const dstRows = Object.values(dstProjections) as Record<string, unknown>[];
        for (const row of dstRows) {
          const rawAbv = String(row.teamAbv ?? "");
          if (!rawAbv) continue;
          const abv = normalizeAbv(rawAbv);
          map[`dst:${abv}`] = { stats: toDstStatsShape(row), pos: "DST", team: abv };
        }
        if (!cancelled) {
          setProjections(map);
          setDebug(current => ({ ...current, playerCount: playerRows.length, dstCount: dstRows.length }));
          try { sessionStorage.setItem(`${CACHE_PREFIX}${currentSeason}_w${currentWeek}`, JSON.stringify(map)); } catch { /* ignore */ }
        }
      })
      .catch(error => { if (!cancelled) { setProjections({}); setDebug(current => ({ ...current, error: error instanceof Error ? error.message : String(error) })); } })
      .finally(() => { if (!cancelled) setLoading(false); });
  };

  const fetchedForKey = useRef<string | null>(null);
  useEffect(() => {
    if (!week || !rules.length) return;
    const cacheKey = `${season}_w${week}`;
    if (fetchedForKey.current === cacheKey) return; // already fetched (or already in flight) for this exact week/season
    fetchedForKey.current = cacheKey;
    try {
      const cached = sessionStorage.getItem(`${CACHE_PREFIX}${cacheKey}`);
      if (cached) {
        const parsed = JSON.parse(cached) as CvcProjectionMap;
        if (Object.keys(parsed).length > 0) { setProjections(parsed); return; }
      }
    } catch { /* ignore */ }
    runFetch("auto");
  }); // Intentionally no dependency array: re-checks readiness on every render (guarded
  // by fetchedForKey, so it's still a no-op once fetched) instead of relying on React's
  // dependency-array change detection for week/rules, which appeared to only ever fire
  // once on initial mount and never again despite week/rules later becoming ready --
  // confirmed via the debug panel's frozen "run #1, week=undefined" state persisting
  // long after the same render's board.data clearly showed a resolved week.

  return { projections, loading, debug, retryNow: () => runFetch("manual retry") };
}

/** Computes a player's projected points lazily from their raw projected stat line,
 * using the position the CALLER supplies (CVC's own player record) -- not a
 * pre-computed number, for the same reason getCvcLivePoints computes live points
 * lazily instead of trusting Tank01's own row.pos: Tank01 offers no reliable position
 * of its own, and CVC's scoring rules are position-gated (a TE's reception bonus, for
 * example, only applies if the position passed in actually says "TE"). Falls back to
 * the provider's own pos only when the caller doesn't have one (e.g. an unrostered
 * free agent with no CVC position on record yet). */
export function getCvcProjectedPoints(projections: CvcProjectionMap, playerName: string, position: string | null | undefined, nflTeam: string | null | undefined, rules: CvcScoringRule[]): number | null {
  const resolvedPosition = (position ?? "").toUpperCase() === "DEF" ? "DST" : (position ?? "").toUpperCase();
  if (resolvedPosition === "DST") {
    const entry = projections[`dst:${normalizeAbv(nflTeam ?? "")}`];
    if (!entry) return null;
    return Math.max(0, Math.round(calculateCvcFantasyPoints(entry.stats, "DST", rules) * 10) / 10);
  }
  const entry = projections[playerName.toLowerCase()] ?? projections[normalizePlayerName(playerName)];
  if (!entry) return null;
  return Math.max(0, Math.round(calculateCvcFantasyPoints(entry.stats, resolvedPosition || entry.pos, rules) * 10) / 10);
}
