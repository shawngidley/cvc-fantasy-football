import { useCallback, useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

const TANK01_BASE_URL = "/api/tank01";
const POLL_INTERVAL_MS = 30_000;

type TankGame = { gameID?: string; away?: string; home?: string; gameDate?: string; gameTime?: string };
type LiveScoreMap = Record<string, number>;
export type CvcNflMatchup = { opponent: string; isHome: boolean; gameTime: string; gameDate: string; gameId: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

function isGameActive(gameDate?: string, gameTime?: string): boolean {
  if (!gameDate || !gameTime || gameDate.length < 8) return false;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return false;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  const kickoff = new Date(`${gameDate.slice(0, 4)}-${gameDate.slice(4, 6)}-${gameDate.slice(6, 8)}T${String(hour + 4).padStart(2, "0")}:${time[2]}:00Z`).getTime();
  const now = Date.now();
  return now >= kickoff && now <= kickoff + 4 * 60 * 60 * 1000;
}

export function useCvcTank01LiveScores(week: number | undefined, season: number | undefined, rules: CvcScoringRule[]) {
  const [scores, setScores] = useState<LiveScoreMap>({});
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nflMatchups, setNflMatchups] = useState<Record<string, CvcNflMatchup>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!week || !season || !rules.length) return [] as TankGame[];
    const response = await fetch(`${TANK01_BASE_URL}/getNFLGamesForWeek?week=${week}&seasonType=Regular%20Season&season=${season}`);
    if (!response.ok) throw new Error(`Tank01 schedule request failed (${response.status})`);
    const payload = await response.json() as { body?: TankGame[] };
    const games = payload.body ?? [];
    const nextMatchups: Record<string, CvcNflMatchup> = {};
    for (const game of games) {
      if (!game.gameID || !game.away || !game.home) continue;
      nextMatchups[normalizeTeam(game.away)] = { opponent: normalizeTeam(game.home), isHome: false, gameTime: game.gameTime ?? "", gameDate: game.gameDate ?? "", gameId: game.gameID };
      nextMatchups[normalizeTeam(game.home)] = { opponent: normalizeTeam(game.away), isHome: true, gameTime: game.gameTime ?? "", gameDate: game.gameDate ?? "", gameId: game.gameID };
    }
    setNflMatchups(nextMatchups);
    return games.filter(game => game.gameID && isGameActive(game.gameDate, game.gameTime));
  }, [rules.length, season, week]);

  const refresh = useCallback(async () => {
    try {
      const activeGames = await load();
      if (!activeGames.length) { setIsPolling(false); return false; }
      setIsPolling(true);
      setError(null);
      const next: LiveScoreMap = {};
      await Promise.all(activeGames.map(async game => {
        const response = await fetch(`${TANK01_BASE_URL}/getNFLBoxScore?gameID=${encodeURIComponent(game.gameID ?? "")}`);
        if (!response.ok) throw new Error(`Tank01 box-score request failed (${response.status})`);
        const payload = await response.json() as { body?: { playerStats?: Record<string, Record<string, unknown>>; teamStats?: Record<string, Tank01LiveStats> } };
        for (const stat of Object.values(payload.body?.playerStats ?? {})) {
          const name = String(stat.longName ?? "");
          const position = String(stat.pos ?? "");
          if (name && position) next[normalize(name)] = calculateCvcFantasyPoints(stat as Tank01LiveStats, position, rules);
        }
        for (const [team, stat] of Object.entries(payload.body?.teamStats ?? {})) next[`dst:${normalizeTeam(team)}`] = calculateCvcFantasyPoints({ Defense: stat as unknown as Record<string, string | number> }, "DST", rules);
      }));
      setScores(next);
      setLastUpdated(new Date());
      return true;
    } catch (cause) {
      setIsPolling(false);
      setError(cause instanceof Error ? cause.message : "Tank01 live data could not load.");
      return false;
    }
  }, [load, rules]);

  useEffect(() => {
    let active = true;
    const cycle = async () => { const shouldPoll = await refresh(); if (active && shouldPoll) timer.current = setTimeout(cycle, POLL_INTERVAL_MS); };
    void cycle();
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  return { scores, nflMatchups, isPolling, lastUpdated, error };
}

export function getCvcLivePoints(scores: LiveScoreMap, playerName: string, position: string, nflTeam: string | null | undefined): number | null {
  if (position === "DST") return scores[`dst:${normalizeTeam(nflTeam ?? "")}`] ?? null;
  return scores[normalize(playerName)] ?? null;
}
