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
function normalizeTeam(team) {
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
  const abv = normalizeTeam(team);
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
    const result = await syncNflTeamSchedules(season.year);
    res.json({ ok: true, ...result });
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
