import { useCallback, useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

const TANK01_BASE_URL = "/api/tank01";
const POLL_INTERVAL_MS = 30_000;

type TankGame = { gameID?: string; away?: string; home?: string; gameDate?: string; gameTime?: string };
type LiveScoreMap = Record<string, number>;
export type LiveStatMap = Record<string, Tank01LiveStats>;
export type CvcNflMatchup = { opponent: string; isHome: boolean; gameTime: string; gameDate: string; gameId: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeTeam = (value: string) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[value.toLowerCase()] ?? value.toLowerCase());

/** Parses a Tank01 gameDate (YYYYMMDD) + gameTime ("8:20p" style, assumed ET) into a
 * UTC kickoff timestamp. Uses Date.UTC (not a string-interpolated "...T${hour}:00Z"
 * timestamp) because for any 8pm-or-later local kickoff, hour + 4 overflows past 23
 * (e.g. 20 + 4 = 24). A string-built "T24:20:00Z" is not a valid ISO hour and silently
 * parses to an Invalid Date (NaN), which made every comparison against it false --
 * meaning prime time games (a large share of the week's games) never registered as
 * "active" at all. Date.UTC() correctly rolls hour 24 into 00:00 of the next UTC day.
 * Returns null if the inputs can't be parsed. */
export function computeKickoffUtc(gameDate: string | undefined, gameTime: string | undefined): number | null {
  if (!gameDate || !gameTime || gameDate.length < 8) return null;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return null;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return Date.UTC(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)) - 1, Number(gameDate.slice(6, 8)), hour + 4, Number(time[2]), 0);
}

function isGameActive(gameDate?: string, gameTime?: string): boolean {
  const kickoff = computeKickoffUtc(gameDate, gameTime);
  if (kickoff === null) return false;
  const now = Date.now();
  return now >= kickoff && now <= kickoff + 4 * 60 * 60 * 1000;
}

export function useCvcTank01LiveScores(week: number | undefined, season: number | undefined, rules: CvcScoringRule[]) {
  const [scores, setScores] = useState<LiveScoreMap>({});
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nflMatchups, setNflMatchups] = useState<Record<string, CvcNflMatchup>>({});
  const [statLines, setStatLines] = useState<LiveStatMap>({});
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
      const nextStatLines: LiveStatMap = {};
      await Promise.all(activeGames.map(async game => {
        const response = await fetch(`${TANK01_BASE_URL}/getNFLBoxScore?gameID=${encodeURIComponent(game.gameID ?? "")}&fantasyPoints=true&twoPointConversions=2&passYards=.04&passTD=4&passInterceptions=-3&pointsPerReception=1&carries=0&rushYards=.1&rushTD=6&fumbles=-3&receivingYards=.1&receivingTD=6&targets=0&defTD=6&fgMade=0&fgYards=.1&xpMade=1`);
        if (!response.ok) throw new Error(`Tank01 box-score request failed (${response.status})`);
        const payload = await response.json() as { body?: { playerStats?: Record<string, Record<string, unknown>>; teamStats?: Record<string, Tank01LiveStats> } };
        for (const stat of Object.values(payload.body?.playerStats ?? {})) {
          const name = String(stat.longName ?? "");
          const position = String(stat.pos ?? "");
          if (name && position) { next[normalize(name)] = calculateCvcFantasyPoints(stat as Tank01LiveStats, position, rules); nextStatLines[normalize(name)] = stat as Tank01LiveStats; }
        }
        for (const [team, stat] of Object.entries(payload.body?.teamStats ?? {})) {
          const key = `dst:${normalizeTeam(team)}`;
          next[key] = calculateCvcFantasyPoints({ Defense: stat as unknown as Record<string, string | number> }, "DST", rules);
          nextStatLines[key] = { Defense: stat as unknown as Record<string, string | number> };
        }
      }));
      setScores(next);
      setStatLines(nextStatLines);
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

  return { scores, statLines, nflMatchups, isPolling, lastUpdated, error };
}

export function getCvcLivePoints(scores: LiveScoreMap, playerName: string, position: string, nflTeam: string | null | undefined): number | null {
  if (position === "DST") return scores[`dst:${normalizeTeam(nflTeam ?? "")}`] ?? null;
  return scores[normalize(playerName)] ?? null;
}
