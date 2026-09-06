import { useEffect, useRef, useState } from "react";

export type TankRecord = Record<string, unknown>;

const TEAM_CODE_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };
const scheduleCache = new Map<string, TankRecord[] | null>();

export function normalizeTeam(team: string | null | undefined): string {
  return TEAM_CODE_ALIASES[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase();
}
export function teamLogoUrl(team: string | null | undefined): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${normalizeTeam(team)}.png`;
}

export function firstOf(source: TankRecord | undefined, keys: string[]): string | null {
  for (const key of keys) { const candidate = source?.[key]; if (candidate !== undefined && candidate !== null && candidate !== "") return String(candidate); }
  return null;
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr.length < 8) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = Number.parseInt(dateStr.slice(4, 6), 10);
  const day = Number.parseInt(dateStr.slice(6, 8), 10);
  return `${months[month - 1] ?? ""} ${day}`;
}

export function useTeamSchedule(team: string | null | undefined, enabled: boolean) {
  const [games, setGames] = useState<TankRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  useEffect(() => {
    if (!enabled || !team) return;
    const abv = normalizeTeam(team).toUpperCase();
    const cached = scheduleCache.get(abv);
    if (cached) { setGames(cached); return; } // only trust a cached *successful* result
    let ignore = false;
    setLoading(true);
    fetch(`/api/tank01/getNFLTeamSchedule?teamAbv=${encodeURIComponent(abv)}`)
      .then(response => (response.ok ? response.json() : null) as Promise<{ body?: TankRecord | TankRecord[] } | null>)
      .then(payload => {
        if (!ignore) setRawResponse(payload);
        const raw = payload?.body;
        const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).filter((entry): entry is TankRecord => Boolean(entry) && typeof entry === "object") : [];
        if (list.length) scheduleCache.set(abv, list);
        if (!ignore) setGames(list.length ? list : null);
      })
      .catch(() => { if (!ignore) setGames(null); }) // not cached -- allow a retry next time
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [team, enabled]);
  return { games, loading, rawResponse };
}

export function gameOpponent(game: TankRecord, team: string) {
  const abv = normalizeTeam(team).toUpperCase();
  const away = firstOf(game, ["away", "awayTeam", "away_team"]);
  const home = firstOf(game, ["home", "homeTeam", "home_team"]);
  if (!away || !home) return null;
  return away.toUpperCase() === abv ? { opponent: home, atOrVs: "@" } : { opponent: away, atOrVs: "vs" };
}

/** Schedule rows in week-number order, with a synthetic BYE WEEK row inserted at any
 * gap in the sequence (Tank01's schedule response has no explicit bye-week entry). */
export function buildScheduleWithBye(schedule: TankRecord[], team: string) {
  const rows = schedule
    .filter(game => { const seasonType = firstOf(game, ["seasonType", "season_type"]); return !seasonType || seasonType === "Regular Season"; })
    .map(game => ({ game, week: Number.parseInt(firstOf(game, ["gameWeek", "week"])?.replace(/\D/g, "") ?? "0", 10), opponent: gameOpponent(game, team) }))
    .filter(row => row.week > 0 && row.opponent)
    .sort((a, b) => a.week - b.week);
  const withBye: ({ type: "game"; week: number; game: TankRecord; opponent: { opponent: string; atOrVs: string } } | { type: "bye"; week: number })[] = [];
  let expected = 1;
  for (const row of rows) {
    while (expected < row.week) { withBye.push({ type: "bye", week: expected }); expected += 1; }
    withBye.push({ type: "game", week: row.week, game: row.game, opponent: row.opponent! });
    expected = row.week + 1;
  }
  return withBye;
}

export type ScheduleSummary = { byeWeek: number | null; nextOpponent: { opponent: string; atOrVs: string } | null; nextGameTime: string | null };

let lastFetchDebug: { teamsRequested: string[]; url: string | null; status: number | null; rawBody: unknown; error: string | null } = { teamsRequested: [], url: null, status: null, rawBody: null, error: null };
export function getLastScheduleFetchDebug() { return lastFetchDebug; }

/** Given a team's full schedule, returns the bye week number (if findable) and the
 * next unplayed game's opponent/time. */
export function summarizeSchedule(schedule: TankRecord[] | null, team: string | null | undefined): ScheduleSummary {
  if (!schedule || !team) return { byeWeek: null, nextOpponent: null, nextGameTime: null };
  const rows = buildScheduleWithBye(schedule, team);
  const byeWeek = rows.find(row => row.type === "bye")?.week ?? null;
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const nextGameRow = rows.find(row => row.type === "game" && (firstOf(row.game, ["gameDate", "date"]) ?? "") >= todayStr);
  if (nextGameRow && nextGameRow.type === "game") {
    return { byeWeek, nextOpponent: nextGameRow.opponent, nextGameTime: firstOf(nextGameRow.game, ["gameTime", "time"]) };
  }
  return { byeWeek, nextOpponent: null, nextGameTime: null };
}

async function fetchTeamSchedule(abv: string): Promise<TankRecord[] | null> {
  const cached = scheduleCache.get(abv);
  if (cached) return cached; // only trust a cached *successful* result; never trust a cached null
  const url = `/api/tank01/getNFLTeamSchedule?teamAbv=${encodeURIComponent(abv)}`;
  try {
    const response = await fetch(url);
    const payload = await (response.ok ? response.json() : response.json().catch(() => null)) as { body?: TankRecord | TankRecord[]; error?: string } | null;
    lastFetchDebug = { teamsRequested: [...lastFetchDebug.teamsRequested, abv], url, status: response.status, rawBody: payload, error: payload?.error ?? null };
    const raw = payload?.body;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).filter((entry): entry is TankRecord => Boolean(entry) && typeof entry === "object") : [];
    if (list.length) scheduleCache.set(abv, list);
    return list.length ? list : null;
  } catch (error) {
    lastFetchDebug = { teamsRequested: [...lastFetchDebug.teamsRequested, abv], url, status: null, rawBody: null, error: error instanceof Error ? error.message : String(error) };
    return null; // not cached -- allow a retry next time
  }
}

/** For pages listing many players across many NFL teams at once (Free Agents), rather
 * than one useTeamSchedule call per team, which isn't possible anyway (React hooks
 * can't be called in a loop/conditionally). Fetches every distinct team's schedule
 * once (deduplicated, cached), returns a map keyed by uppercase team abbreviation.
 * Uses a ref-guarded effect with no dependency array (re-checks readiness on every
 * render instead of relying on React's dependency-change detection for the joined
 * team-list string) -- the same fix that resolved an effect that appeared to fire
 * once and never again despite its inputs clearly changing on later renders, in
 * useCvcNFLProjections.ts earlier today. */
export function useTeamSchedulesFor(teams: (string | null | undefined)[]): { schedules: Record<string, ScheduleSummary>; loading: boolean } {
  const uniqueTeams = Array.from(new Set(teams.filter((team): team is string => Boolean(team)).map(team => normalizeTeam(team).toUpperCase()))).sort().join(",");
  const [schedules, setSchedules] = useState<Record<string, ScheduleSummary>>({});
  const [loading, setLoading] = useState(false);
  const fetchedForKey = useRef<string | null>(null);

  useEffect(() => {
    if (fetchedForKey.current === uniqueTeams) return; // already fetched (or in flight) for this exact team set
    fetchedForKey.current = uniqueTeams;
    const teamList = uniqueTeams ? uniqueTeams.split(",") : [];
    if (!teamList.length) { setSchedules({}); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all(teamList.map(async abv => {
      const schedule = await fetchTeamSchedule(abv);
      return [abv, summarizeSchedule(schedule, abv)] as const;
    })).then(entries => {
      if (!cancelled) setSchedules(Object.fromEntries(entries));
    }).finally(() => { if (!cancelled) setLoading(false); });
  }); // Intentionally no dependency array -- see comment above.

  return { schedules, loading };
}
