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

// server/cvcPlayerWeeklyStats.ts
var SUM_FIELDS = ["pass_yds", "pass_td", "pass_int", "rush_att", "rush_yds", "rush_td", "targets", "receptions", "rec_yds", "rec_td", "fg_made", "xp_made", "sacks", "def_int", "def_td"];
function aggregateWeeklyStatsForSeason(weeklyRows) {
  const gamesPlayed = weeklyRows.reduce((sum, row) => sum + row.games_played, 0);
  const fantasyPoints = Math.round(weeklyRows.reduce((sum, row) => sum + row.fantasy_points, 0) * 100) / 100;
  const summed = {};
  for (const field of SUM_FIELDS) {
    const values = weeklyRows.map((row) => row[field]).filter((value) => value !== null);
    summed[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return {
    games_played: gamesPlayed,
    pass_yds: summed.pass_yds,
    pass_td: summed.pass_td,
    pass_int: summed.pass_int,
    rush_att: summed.rush_att,
    rush_yds: summed.rush_yds,
    rush_td: summed.rush_td,
    targets: summed.targets,
    receptions: summed.receptions,
    rec_yds: summed.rec_yds,
    rec_td: summed.rec_td,
    fg_made: summed.fg_made,
    xp_made: summed.xp_made,
    sacks: summed.sacks,
    def_int: summed.def_int,
    def_td: summed.def_td,
    fantasy_points: fantasyPoints,
    fantasy_points_per_game: gamesPlayed > 0 ? Math.round(fantasyPoints / gamesPlayed * 100) / 100 : null
  };
}
async function rebuildSeasonStatsCurrentForAllPlayers(seasonId) {
  const PAGE_SIZE = 1e3;
  const allRows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase.from("cvc_player_weekly_stat").select("player_id, games_played, pass_yds, pass_td, pass_int, rush_att, rush_yds, rush_td, targets, receptions, rec_yds, rec_td, fg_made, xp_made, sacks, def_int, def_td, fantasy_points").eq("season_id", seasonId).range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { playersRebuilt: 0 };
    const page = result.data ?? [];
    allRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (!allRows.length) return { playersRebuilt: 0 };
  const byPlayer = /* @__PURE__ */ new Map();
  for (const row of allRows) {
    const existing = byPlayer.get(row.player_id) ?? [];
    existing.push(row);
    byPlayer.set(row.player_id, existing);
  }
  const upsertRows = Array.from(byPlayer).map(([playerId, playerRows]) => ({ season_id: seasonId, player_id: playerId, ...aggregateWeeklyStatsForSeason(playerRows), updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
  const UPSERT_BATCH_SIZE = 500;
  for (let index = 0; index < upsertRows.length; index += UPSERT_BATCH_SIZE) {
    const batch = upsertRows.slice(index, index + UPSERT_BATCH_SIZE);
    const result = await supabase.from("cvc_season_stats_current").upsert(batch, { onConflict: "season_id,player_id" });
    if (result.error) return { playersRebuilt: index };
  }
  return { playersRebuilt: upsertRows.length };
}

// server/nflTeamAssignmentSync.ts
import { parse } from "csv-parse/sync";

// server/fantasyProsNews.ts
var LOCAL_CACHE_TTL_MS = 5 * 6e4;

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
async function runSeasonStatsCurrentRebuild(req, res) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) {
      res.json({ ok: true, status: "skipped", reason: "No current season found." });
      return;
    }
    const result = await rebuildSeasonStatsCurrentForAllPlayers(season.id);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Season stats current rebuild failed", error);
    res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelScheduledSeasonStatsCurrentRebuild.ts
async function handler(req, res) {
  return runSeasonStatsCurrentRebuild(req, res);
}
export {
  handler as default
};
