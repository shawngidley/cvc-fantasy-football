import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

const TEAM_CODE_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };
const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAC", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH",
];

function normalizeTeam(team: string | null | undefined): string {
  return (TEAM_CODE_ALIASES[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase()).toUpperCase();
}

function firstOf(source: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) { const candidate = source?.[key]; if (candidate !== undefined && candidate !== null && candidate !== "") return String(candidate); }
  return null;
}

/** Same gap-in-the-week-sequence bye detection already proven client-side in
 * client/src/lib/nflSchedule.ts's buildScheduleWithBye, ported for server-side use
 * (server code can't import from client/src). Regular-season games only. */
function summarizeTeamSchedule(games: Record<string, unknown>[], team: string) {
  const abv = normalizeTeam(team);
  const rows = games
    .filter(game => { const seasonType = firstOf(game, ["seasonType", "season_type"]); return !seasonType || seasonType === "Regular Season"; })
    .map(game => {
      const week = Number.parseInt(firstOf(game, ["gameWeek", "week"])?.replace(/\D/g, "") ?? "0", 10);
      const away = firstOf(game, ["away", "awayTeam", "away_team"]);
      const home = firstOf(game, ["home", "homeTeam", "home_team"]);
      const isHome = away && home ? away.toUpperCase() !== abv : null;
      const opponent = away && home ? (away.toUpperCase() === abv ? home : away) : null;
      return { game, week, opponent, isHome };
    })
    .filter(row => row.week > 0 && row.opponent)
    .sort((a, b) => a.week - b.week);

  let byeWeek: number | null = null;
  let expected = 1;
  for (const row of rows) {
    if (expected < row.week) { byeWeek = expected; break; } // first gap found is the bye
    expected = row.week + 1;
  }

  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const nextGameRow = rows.find(row => (firstOf(row.game, ["gameDate", "date"]) ?? "") >= todayStr);

  return {
    byeWeek,
    nextOpponent: nextGameRow?.opponent ?? null,
    nextOpponentIsHome: nextGameRow?.isHome ?? null,
    nextGameDate: nextGameRow ? firstOf(nextGameRow.game, ["gameDate", "date"]) : null,
    nextGameTime: nextGameRow ? firstOf(nextGameRow.game, ["gameTime", "time"]) : null,
  };
}

export type NflTeamScheduleSyncSummary = { status: "skipped" | "completed"; reason?: string; teamsUpdated: number };

export const __testables = { summarizeTeamSchedule };

/** Computes and caches every NFL team's bye week and next opponent once, server-side,
 * instead of every browser fetching and parsing a full season schedule per team on
 * every Free Agents page load (32 external API calls per page view). Meant to run
 * daily -- NFL schedules essentially never change mid-week. */
export async function syncNflTeamSchedules(year: number): Promise<NflTeamScheduleSyncSummary> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", reason: "Tank01 is not configured.", teamsUpdated: 0 };

  let teamsUpdated = 0;
  for (const team of NFL_TEAMS) {
    try {
      const games = await adapter.getTeamSchedule(team, year);
      const summary = summarizeTeamSchedule(games, team);
      unwrap(await supabase.from("nfl_team_schedule_cache").upsert({
        nfl_team: team, bye_week: summary.byeWeek, next_opponent: summary.nextOpponent,
        next_opponent_is_home: summary.nextOpponentIsHome, next_game_date: summary.nextGameDate,
        next_game_time: summary.nextGameTime, synced_at: new Date().toISOString(),
      }, { onConflict: "nfl_team" }).select("nfl_team").single());
      teamsUpdated += 1;
    } catch { /* one bad team's fetch shouldn't abort the rest */ }
  }
  return { status: "completed", teamsUpdated };
}
