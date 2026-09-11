import { useCallback, useEffect, useRef, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getKickerEventsForPlayer, parseEspnKickerEvents, sumMadeFieldGoalYards, countMadeExtraPoints, type KickerPlayEvent } from "@/lib/espnKickerEvents";

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

// CRITICAL: these two checks must stay separate. Using one wide window for both
// "should we fetch this game's box score at all" AND "should the recurring 30-second
// poll keep rescheduling itself" caused a real production incident in WRC (this same
// architecture): once any game kicked off, the poll never stopped for the entire wide
// window -- every open browser tab kept hitting Tank01/ESPN every 30 seconds,
// continuously, for the full window (hours or days) even though the actual game ended
// in ~3-4 hours. That's more than enough sustained volume to exhaust an API quota that
// was previously fine.
//
// isGameFetchEligible (wide -- effectively the rest of the CVC week): which games are
// worth fetching a box score for at all. Deliberately has NO upper bound -- the caller
// already scopes the schedule fetch to just the current week's ~16 games via
// getNFLGamesForWeek, so there's no risk of pulling in a stale game from a different
// week. A fixed time-based upper bound here (this previously used 24h) caused a real
// bug: once a game aged past that window, its stats simply stopped being fetched at
// all and disappeared from Live Scoring mid-week, even though that game's results
// still count for the whole CVC week (through Sunday/Monday games and the Friday
// correction window). Same reasoning already applied server-side in
// tank01ScoringSync.ts's hasKickedOff, which also has no upper bound for the same
// reason -- this just brings the client-side check in line with that.
export function isGameFetchEligible(gameDate?: string, gameTime?: string): boolean {
  const kickoff = computeKickoffUtc(gameDate, gameTime);
  if (kickoff === null) return false;
  return Date.now() >= kickoff;
}

// isGameCurrentlyLive (narrow, ~4.5h from kickoff): whether the RECURRING poll should
// keep rescheduling itself. The poll still does one fetch for anything fetch-eligible,
// but only keeps re-scheduling while something is within this narrow window. Once
// nothing is, it fetches once more and stops.
export function isGameCurrentlyLive(gameDate?: string, gameTime?: string): boolean {
  const kickoff = computeKickoffUtc(gameDate, gameTime);
  if (kickoff === null) return false;
  const now = Date.now();
  return now >= kickoff && now <= kickoff + 4.5 * 60 * 60 * 1000;
}


/** Fetches real per-kick FG/XP events from ESPN's play-by-play for each active game,
 * matching WRC's proven approach: for each active game's date, fetch ESPN's scoreboard
 * to find the matching event ID (by home/away team abbreviation), then fetch that
 * event's summary and parse kicker plays out of the play-by-play text. This exists
 * because Tank01's live box score doesn't reliably include FG yardage at all -- CVC's
 * own scoring needs exact yardage (0.1 pts/yard), not just a made-count. */
async function fetchEspnKickerEvents(activeGames: TankGame[]): Promise<KickerPlayEvent[]> {
  const events: KickerPlayEvent[] = [];
  const seen = new Set<string>();
  const dates = Array.from(new Set(activeGames.map(game => game.gameDate).filter((date): date is string => Boolean(date))));
  for (const date of dates) {
    try {
      const scoreboard = await fetch(`/api/espn/scoreboard?dates=${date}`);
      if (!scoreboard.ok) continue;
      const payload = await scoreboard.json() as { events?: Array<{ id?: string; competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }> }> }> };
      for (const game of activeGames.filter(candidate => candidate.gameDate === date)) {
        const espnEvent = payload.events?.find(candidate => {
          const competitors = candidate.competitions?.[0]?.competitors ?? [];
          const home = competitors.find(item => item.homeAway === "home")?.team?.abbreviation;
          const away = competitors.find(item => item.homeAway === "away")?.team?.abbreviation;
          return normalizeTeam(home ?? "") === normalizeTeam(game.home ?? "") && normalizeTeam(away ?? "") === normalizeTeam(game.away ?? "");
        });
        if (!espnEvent?.id) continue;
        const summary = await fetch(`/api/espn/summary?event=${espnEvent.id}`);
        if (!summary.ok) continue;
        for (const play of parseEspnKickerEvents(await summary.json())) {
          const key = `${play.playerName}|${play.type}|${play.outcome}|${play.yards}|${play.text}`;
          if (!seen.has(key)) { seen.add(key); events.push(play); }
        }
      }
    } catch { /* one bad date's ESPN fetch shouldn't block the rest */ }
  }
  return events;
}

export function useCvcTank01LiveScores(week: number | undefined, season: number | undefined, rules: CvcScoringRule[]) {
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nflMatchups, setNflMatchups] = useState<Record<string, CvcNflMatchup>>({});
  const [statLines, setStatLines] = useState<LiveStatMap>({});
  const [kickerEvents, setKickerEvents] = useState<KickerPlayEvent[]>([]);
  const [rawBoxScoreDebug, setRawBoxScoreDebug] = useState<{ url: string; status: number; body: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against the effect re-running (e.g. because `rules` -- an array built with
  // `rules.data ?? []` in the caller -- gets a new reference on every render, which it
  // does here every 30s as this hook's own state updates trigger a parent re-render)
  // and firing an unconditional "initial fetch" again even after polling had already
  // determined no game is in progress for this week. Once set, every fetch attempt --
  // including that unconditional initial one -- is skipped for as long as `week`
  // matches, making the stop guaranteed rather than dependent on the effect never
  // re-running.
  const stoppedForWeekRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!week || !season || !rules.length) return { fetchEligibleGames: [] as TankGame[], anyCurrentlyLive: false };
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
    const fetchEligibleGames = games.filter(game => game.gameID && isGameFetchEligible(game.gameDate, game.gameTime));
    const anyCurrentlyLive = games.some(game => game.gameID && isGameCurrentlyLive(game.gameDate, game.gameTime));
    return { fetchEligibleGames, anyCurrentlyLive };
  }, [rules.length, season, week]);

  const refresh = useCallback(async () => {
    if (week != null && stoppedForWeekRef.current === week) { setIsPolling(false); return false; }
    try {
      const { fetchEligibleGames, anyCurrentlyLive } = await load();
      if (!fetchEligibleGames.length) { setIsPolling(false); if (week != null) stoppedForWeekRef.current = week; return false; }
      setIsPolling(true);
      setError(null);
      const nextStatLines: LiveStatMap = {};
      let capturedDebug: { url: string; status: number; body: unknown } | null = null;
      await Promise.all(fetchEligibleGames.map(async game => {
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
      // Override kicker stats with real per-kick ESPN data where available. Tank01's
      // live box score doesn't reliably include FG yardage at all (confirmed: none of
      // the players in a real, verified live box score had usable Kicking.fgYds), so
      // without this, a made field goal scores as if it were 0 yards. Only the field(s)
      // ESPN actually gave events for get overridden -- if ESPN parsing fails to find
      // events for a kicker (e.g. the play text didn't match, or nothing's happened
      // yet), that kicker's stat line is left as Tank01 provided it, not blanked out.
      try {
        const kickerEvents = await fetchEspnKickerEvents(fetchEligibleGames);
        setKickerEvents(kickerEvents);
        if (kickerEvents.length) {
          setStatLines(current => {
            const next = { ...current };
            for (const key of Object.keys(next)) {
              if (key.startsWith("dst:")) continue;
              const entry = next[key] as Record<string, unknown>;
              const longName = String(entry.longName ?? "");
              const existingKicking = entry.Kicking as Record<string, unknown> | undefined;
              // Only a player Tank01 already flagged with FG attempt data is treated as
              // a place-kicker here -- a returner's Kicking field (kick-return yards)
              // has no fgMade at all, so this avoids misapplying FG/XP data to them even
              // if their name happens to match an ESPN kicker event.
              if (!longName || !existingKicking || existingKicking.fgMade === undefined) continue;
              const playerEvents = getKickerEventsForPlayer(kickerEvents, longName);
              if (!playerEvents.length) continue;
              const fgYds = sumMadeFieldGoalYards(playerEvents);
              const xpMade = countMadeExtraPoints(playerEvents);
              const hasFgEvents = playerEvents.some(event => event.type === "fg");
              const hasXpEvents = playerEvents.some(event => event.type === "xp");
              next[key] = { ...entry, Kicking: { ...existingKicking, ...(hasFgEvents ? { fgYds } : {}), ...(hasXpEvents ? { xpMade } : {}) } } as Tank01LiveStats;
            }
            return next;
          });
        }
      } catch { /* ESPN kicker-event fetch failing shouldn't break the rest of live scoring */ }
      // CRITICAL: this must be anyCurrentlyLive (narrow window), not
      // fetchEligibleGames.length > 0 (wide window). Returning true here is what tells
      // the poll loop to reschedule itself again in 30 seconds -- tying that decision to
      // the wide window is exactly what caused the runaway-polling incident: the poll
      // would never stop for up to 24 hours after any kickoff, regardless of whether the
      // game itself had already ended hours earlier.
      if (!anyCurrentlyLive && week != null) stoppedForWeekRef.current = week;
      return anyCurrentlyLive;
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

  return { statLines, nflMatchups, isPolling, lastUpdated, error, rawBoxScoreDebug, kickerEvents };
}

/** Looks up a player's raw live stat line (for rendering real game stats), using the
 * exact same key logic as getCvcLivePoints. */
export function getCvcLiveStatLine(statLines: LiveStatMap, playerName: string, position: string, nflTeam: string | null | undefined): Tank01LiveStats | null {
  const key = position === "DST" ? `dst:${normalizeTeam(nflTeam ?? "")}` : normalize(playerName);
  return statLines[key] ?? null;
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
