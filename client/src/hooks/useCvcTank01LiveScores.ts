import { useCallback, useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

const TANK01_BASE_URL = "/api/tank01";
const POLL_INTERVAL_MS = 30_000;

type TankGame = { gameID?: string; away?: string; home?: string; gameDate?: string; gameTime?: string };
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
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nflMatchups, setNflMatchups] = useState<Record<string, CvcNflMatchup>>({});
  const [statLines, setStatLines] = useState<LiveStatMap>({});
  const [rawBoxScoreDebug, setRawBoxScoreDebug] = useState<{ url: string; status: number; body: unknown } | null>(null);
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
      const nextStatLines: LiveStatMap = {};
      let capturedDebug: { url: string; status: number; body: unknown } | null = null;
      await Promise.all(activeGames.map(async game => {
        const url = `${TANK01_BASE_URL}/getNFLBoxScore?gameID=${encodeURIComponent(game.gameID ?? "")}&fantasyPoints=true&twoPointConversions=2&passYards=.04&passTD=4&passInterceptions=-3&pointsPerReception=1&carries=0&rushYards=.1&rushTD=6&fumbles=-3&receivingYards=.1&receivingTD=6&targets=0&defTD=6&fgMade=0&fgYards=.1&xpMade=1`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Tank01 box-score request failed (${response.status})`);
        const payload = await response.json() as {
          body?: {
            playerStats?: Record<string, Record<string, unknown>>;
            // Confirmed live: this is general team offense stats (totalYards,
            // rushingAttempts, etc.) -- NOT the dedicated defensive-scoring source.
            teamStats?: Record<string, Record<string, unknown>>;
            // Confirmed live: the actual DST scoring source, keyed "away"/"home" with
            // the real team code inside each entry's own teamAbv field (not the outer
            // key itself, which is just the literal string "away"/"home").
            DST?: Record<string, Record<string, unknown>>;
          };
        };
        if (!capturedDebug) capturedDebug = { url, status: response.status, body: payload };
        // Confirmed live: Tank01's playerStats entries have no "pos" field at all --
        // position must come from the caller (CVC's own player record) at lookup time,
        // not from this raw stat line. Store the raw stat here; getCvcLivePoints
        // computes fantasy points lazily once it has the real position.
        for (const stat of Object.values(payload.body?.playerStats ?? {})) {
          const name = String(stat.longName ?? "");
          if (name) nextStatLines[normalize(name)] = stat as Tank01LiveStats;
        }
        for (const stat of Object.values(payload.body?.DST ?? {})) {
          const teamAbv = String(stat.teamAbv ?? "");
          if (teamAbv) nextStatLines[`dst:${normalizeTeam(teamAbv)}`] = { Defense: stat as unknown as Record<string, string | number> };
        }
      }));
      setStatLines(nextStatLines);
      setRawBoxScoreDebug(capturedDebug);
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

  return { statLines, nflMatchups, isPolling, lastUpdated, error, rawBoxScoreDebug };
}

/** Computes a player's live fantasy points lazily, from the raw stat line, using the
 * position the CALLER supplies (CVC's own player record) -- not a pre-computed score,
 * since Tank01's box score gives no reliable position of its own to compute with in
 * advance, and CVC's scoring rules are position-gated (ruleValue only matches a rule
 * when applies_to_positions includes the given position). */
export function getCvcLivePoints(statLines: LiveStatMap, playerName: string, position: string, nflTeam: string | null | undefined, rules: CvcScoringRule[]): number | null {
  const key = position === "DST" ? `dst:${normalizeTeam(nflTeam ?? "")}` : normalize(playerName);
  const stat = statLines[key];
  if (!stat) return null;
  return calculateCvcFantasyPoints(stat, position, rules);
}
