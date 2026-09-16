// server/supabase.ts
import { createClient } from "@supabase/supabase-js";
var url = process.env.SUPABASE_URL;
var secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error("CVC Supabase server configuration is incomplete");
}
var supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});
function unwrap(result) {
  if (result.error) throw new Error(`Supabase query failed: ${result.error.message}`);
  return result.data;
}

// server/fantasyProsCache.ts
var CACHE_TTL_MS = 12 * 60 * 60 * 1e3;

// server/nflDataAdapter.ts
var UnconfiguredNFLDataAdapter = class {
  async status() {
    return { provider: null, configured: false, message: "No CVC NFL data provider has been configured." };
  }
  normalizePlayer(input) {
    return input;
  }
};
var Tank01NFLDataAdapter = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  host = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
  async status() {
    return { provider: "Tank01", configured: true, message: "Tank01 is connected server-side for CVC NFL team and roster data." };
  }
  normalizePlayer(input) {
    return input;
  }
  headers() {
    return { "x-rapidapi-host": this.host, "x-rapidapi-key": this.apiKey };
  }
  // All Tank01 calls below now use a 15s timeout, matching the pattern already used
  // for FantasyPros calls elsewhere -- none of them had one before, confirmed as the
  // cause of the "Sync all players" hang (getPlayerInfo). The same gap existed on
  // listGamesForWeek/getBoxScore, which the live scoring cron calls every 5 minutes
  // during games, and listTeams/listTeamRoster, which the active-roster sync calls --
  // any of these could have hung indefinitely the same way without ever throwing.
  async listTeams() {
    const response = await fetch(`https://${this.host}/getNFLTeams`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLTeams failed with status ${response.status}`);
    return response.json();
  }
  async listTeamRoster(teamAbv) {
    const response = await fetch(`https://${this.host}/getNFLTeamRoster?teamAbv=${encodeURIComponent(teamAbv)}`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLTeamRoster failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLTeamRoster returned ${payload.error}`);
    return payload.body?.roster ?? [];
  }
  async listGamesForWeek(week, season) {
    const params = new URLSearchParams({ week: String(week), season: String(season), seasonType: "Regular Season" });
    const response = await fetch(`https://${this.host}/getNFLGamesForWeek?${params.toString()}`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLGamesForWeek failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLGamesForWeek returned ${payload.error}`);
    return payload.body ?? [];
  }
  async getBoxScore(gameId) {
    const response = await fetch(`https://${this.host}/getNFLBoxScore?gameID=${encodeURIComponent(gameId)}`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLBoxScore failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLBoxScore returned ${payload.error}`);
    return payload.body ?? {};
  }
  async getPlayerInfo(playerName) {
    const response = await fetch(`https://${this.host}/getNFLPlayerInfo?playerName=${encodeURIComponent(playerName)}&getStats=true`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLPlayerInfo failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLPlayerInfo returned ${payload.error}`);
    return Array.isArray(payload.body) ? payload.body[0] ?? null : payload.body ?? null;
  }
  /** Looks up a player by their confirmed Tank01 playerID (from listTeamRoster) rather
   * than searching by name -- an exact ID lookup instead of a fuzzy name search that's
   * confirmed to fail systematically for real, active players. */
  async getPlayerInfoById(playerId) {
    const response = await fetch(`https://${this.host}/getNFLPlayerInfo?playerID=${encodeURIComponent(playerId)}&getStats=true`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLPlayerInfo (by ID) failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLPlayerInfo (by ID) returned ${payload.error}`);
    return Array.isArray(payload.body) ? payload.body[0] ?? null : payload.body ?? null;
  }
  /** Per-game box scores for one player in one season, keyed by gameID
   * ("20260913_BUF@HOU" -- away@home). Powers the player profile's Game Log tab. */
  async getGamesForPlayer(playerId, season) {
    const response = await fetch(`https://${this.host}/getNFLGamesForPlayer?playerID=${encodeURIComponent(playerId)}&season=${season}`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLGamesForPlayer failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLGamesForPlayer returned ${payload.error}`);
    return payload.body ?? {};
  }
  /** Full-season schedule for one NFL team. Powers the player profile's Schedule tab. */
  async getTeamSchedule(teamAbv, season) {
    const response = await fetch(`https://${this.host}/getNFLTeamSchedule?teamAbv=${encodeURIComponent(teamAbv)}&season=${season}`, { headers: this.headers(), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error(`Tank01 getNFLTeamSchedule failed with status ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Tank01 getNFLTeamSchedule returned ${payload.error}`);
    return payload.body?.schedule ?? [];
  }
};
var adapter = process.env.TANK01_RAPIDAPI_KEY ? new Tank01NFLDataAdapter(process.env.TANK01_RAPIDAPI_KEY) : new UnconfiguredNFLDataAdapter();
function getNFLDataAdapter() {
  return adapter;
}

// server/nflTeamAssignmentSync.ts
import { parse } from "csv-parse/sync";

// server/waiverResolutionTiming.ts
var EASTERN_TZ = "America/New_York";
function getEasternDateParts(instant) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: weekdayMap[parts.weekday] };
}
function easternWallClockToUtc(year, month, day, hour) {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(asIfUtc))) parts[part.type] = part.value;
  const reinterpretedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMs = reinterpretedAsUtc - asIfUtc;
  return new Date(asIfUtc - offsetMs);
}

// server/nflTeamScheduleSync.ts
var TEAM_CODE_ALIASES = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };
var NFL_TEAMS = [
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAC",
  "KC",
  "LAC",
  "LAR",
  "LV",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WSH"
];
function normalizeTeam2(team) {
  return (TEAM_CODE_ALIASES[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase()).toUpperCase();
}
function firstOf(source, keys) {
  for (const key of keys) {
    const candidate = source?.[key];
    if (candidate !== void 0 && candidate !== null && candidate !== "") return String(candidate);
  }
  return null;
}
function summarizeTeamSchedule(games, team) {
  const abv = normalizeTeam2(team);
  const rows = games.filter((game) => {
    const seasonType = firstOf(game, ["seasonType", "season_type"]);
    return !seasonType || seasonType === "Regular Season";
  }).map((game) => {
    const week = Number.parseInt(firstOf(game, ["gameWeek", "week"])?.replace(/\D/g, "") ?? "0", 10);
    const away = firstOf(game, ["away", "awayTeam", "away_team"]);
    const home = firstOf(game, ["home", "homeTeam", "home_team"]);
    const isHome = away && home ? away.toUpperCase() !== abv : null;
    const opponent = away && home ? away.toUpperCase() === abv ? home : away : null;
    return { game, week, opponent, isHome };
  }).filter((row) => row.week > 0 && row.opponent).sort((a, b) => a.week - b.week);
  let byeWeek = null;
  let expected = 1;
  for (const row of rows) {
    if (expected < row.week) {
      byeWeek = expected;
      break;
    }
    expected = row.week + 1;
  }
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const nextGameRow = rows.find((row) => (firstOf(row.game, ["gameDate", "date"]) ?? "") >= todayStr);
  return {
    byeWeek,
    nextOpponent: nextGameRow?.opponent ?? null,
    nextOpponentIsHome: nextGameRow?.isHome ?? null,
    nextGameDate: nextGameRow ? firstOf(nextGameRow.game, ["gameDate", "date"]) : null,
    nextGameTime: nextGameRow ? firstOf(nextGameRow.game, ["gameTime", "time"]) : null
  };
}
async function syncNflTeamSchedules(year) {
  const adapter2 = getNFLDataAdapter();
  if (!(adapter2 instanceof Tank01NFLDataAdapter)) return { status: "skipped", reason: "Tank01 is not configured.", teamsUpdated: 0 };
  let teamsUpdated = 0;
  for (const team of NFL_TEAMS) {
    try {
      const games = await adapter2.getTeamSchedule(team, year);
      const summary = summarizeTeamSchedule(games, team);
      unwrap(await supabase.from("nfl_team_schedule_cache").upsert({
        nfl_team: team,
        bye_week: summary.byeWeek,
        next_opponent: summary.nextOpponent,
        next_opponent_is_home: summary.nextOpponentIsHome,
        next_game_date: summary.nextGameDate,
        next_game_time: summary.nextGameTime,
        synced_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "nfl_team" }).select("nfl_team").single());
      teamsUpdated += 1;
    } catch {
    }
  }
  return { status: "completed", teamsUpdated };
}

// server/planningWeek.ts
function parseKickoffUtc(gameDate, gameTime) {
  if (!gameDate || !gameTime || gameDate.length < 8) return null;
  const time = gameTime.match(/(\d+):(\d+)([ap])/i);
  if (!time) return null;
  let hour = Number(time[1]);
  if (time[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (time[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return easternWallClockToUtc(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)), Number(gameDate.slice(6, 8)), hour);
}
function computePlanningWeekCutoff(games) {
  const kickoffs = games.map((game) => parseKickoffUtc(game.gameDate, game.gameTime)).filter((date) => date !== null);
  if (!kickoffs.length) return null;
  const earliestKickoff = new Date(Math.min(...kickoffs.map((date) => date.getTime())));
  const kickoffDateParts = getEasternDateParts(earliestKickoff);
  for (let daysBack = 0; daysBack <= 6; daysBack++) {
    const noonUtcOnCandidateDate = Date.UTC(kickoffDateParts.year, kickoffDateParts.month - 1, kickoffDateParts.day - daysBack, 12);
    const candidateDate = getEasternDateParts(new Date(noonUtcOnCandidateDate));
    if (candidateDate.weekday === 2) return easternWallClockToUtc(candidateDate.year, candidateDate.month, candidateDate.day, 9);
  }
  return null;
}
async function syncPlanningWeekCutoffs(seasonId, seasonYear) {
  const adapter2 = getNFLDataAdapter();
  if (!(adapter2 instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured for the planning-week cutoff sync.");
  const weeks = unwrap(await supabase.from("schedule_week").select("id, week_number").eq("season_id", seasonId)) ?? [];
  let weeksSynced = 0;
  for (const week of weeks) {
    const games = await adapter2.listGamesForWeek(week.week_number, seasonYear).catch(() => []);
    const cutoff = computePlanningWeekCutoff(games);
    if (!cutoff) continue;
    unwrap(await supabase.from("cvc_week_planning_cutoff").upsert({ season_id: seasonId, week_number: week.week_number, cutoff_at: cutoff.toISOString(), synced_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "season_id,week_number" }).select("id").single());
    weeksSynced += 1;
  }
  return { weeksSynced };
}

// server/_core/scheduledHandlers.ts
function checkCronAuth(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
async function getCurrentSeason() {
  const league = unwrap(await supabase.from("league").select("id").eq("slug", "cvc-auction-football").single());
  const flagged = league ? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).eq("is_current", true).limit(1).maybeSingle()) : null;
  const season = flagged ?? (league ? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle()) : null);
  return season;
}
async function runTeamScheduleSync(req, res) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) {
      res.json({ ok: true, status: "skipped", reason: "No current season found." });
      return;
    }
    const [teamScheduleResult, planningWeekResult] = await Promise.all([
      syncNflTeamSchedules(season.year),
      syncPlanningWeekCutoffs(season.id, season.year).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    ]);
    res.json({ ok: true, ...teamScheduleResult, planningWeekCutoff: planningWeekResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NFL team schedule sync failed", error);
    res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelScheduledTeamSchedule.ts
async function handler(req, res) {
  return runTeamScheduleSync(req, res);
}
export {
  handler as default
};
