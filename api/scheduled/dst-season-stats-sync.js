// shared/cvcScoring.ts
var numeric = (value) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};
var ruleValue = (rules, statKey, position) => {
  const rule = rules.find((candidate) => candidate.stat_key === statKey && (!candidate.applies_to_positions?.length || candidate.applies_to_positions.includes(position)));
  return rule ? numeric(rule.value) : 0;
};
function calculateCvcFantasyPointsBreakdown(stats, position, rules) {
  const passing = stats.Passing ?? {};
  const rushing = stats.Rushing ?? {};
  const receiving = stats.Receiving ?? {};
  const kicking = stats.Kicking ?? {};
  const defense = stats.Defense ?? {};
  const items = [];
  const add = (label, points) => {
    if (points !== 0) items.push({ label, points });
  };
  const passYds = numeric(passing.passYds);
  add(`${passYds} passing yds`, passYds * ruleValue(rules, "passing_yards", position));
  const passTD = numeric(passing.passTD);
  add(`${passTD} passing TD${passTD === 1 ? "" : "s"}`, passTD * ruleValue(rules, "passing_touchdown", position));
  const int = numeric(passing.int);
  add(`${int} INT thrown`, int * ruleValue(rules, "interception", position));
  if (passYds >= 350) add("350+ passing yd bonus", ruleValue(rules, "passing_350_bonus", position));
  const rushYds = numeric(rushing.rushYds);
  add(`${rushYds} rushing yds`, rushYds * ruleValue(rules, "rushing_yards", position));
  const rushTD = numeric(rushing.rushTD);
  add(`${rushTD} rushing TD${rushTD === 1 ? "" : "s"}`, rushTD * ruleValue(rules, "rushing_touchdown", position));
  if (rushYds >= 100) add("100+ rushing yd bonus", ruleValue(rules, "rushing_100_bonus", position));
  const recYds = numeric(receiving.recYds);
  add(`${recYds} receiving yds`, recYds * ruleValue(rules, "receiving_yards", position));
  const recTD = numeric(receiving.recTD);
  add(`${recTD} receiving TD${recTD === 1 ? "" : "s"}`, recTD * ruleValue(rules, "receiving_touchdown", position));
  const receptions = numeric(receiving.receptions);
  add(`${receptions} reception${receptions === 1 ? "" : "s"}`, receptions * ruleValue(rules, "reception", position));
  if (recYds >= 100) add("100+ receiving yd bonus", ruleValue(rules, "receiving_100_bonus", position));
  const xpMade = numeric(kicking.xpMade);
  add(`${xpMade} extra point${xpMade === 1 ? "" : "s"} made`, xpMade * ruleValue(rules, "extra_point", position));
  const fgYds = numeric(kicking.fgYds ?? kicking.kickYards);
  add(`${fgYds} field goal yds`, fgYds * ruleValue(rules, "field_goal_yard", position));
  if (position === "DST") {
    const fumblesRecovered = numeric(defense.fumblesRecovered);
    add(`${fumblesRecovered} fumble recover${fumblesRecovered === 1 ? "y" : "ies"}`, fumblesRecovered * ruleValue(rules, "fumble_recovery", position));
    const dInt = numeric(defense.defensiveInterceptions);
    add(`${dInt} interception${dInt === 1 ? "" : "s"}`, dInt * ruleValue(rules, "defensive_interception", position));
    const sacks = numeric(defense.sacks);
    add(`${sacks} sack${sacks === 1 ? "" : "s"}`, sacks * ruleValue(rules, "sack", position));
    const defTD = numeric(defense.defensiveOrSpecialTeamsTds ?? defense.defTD);
    add(`${defTD} defensive TD${defTD === 1 ? "" : "s"}`, defTD * ruleValue(rules, "defensive_touchdown", position));
    const safeties = numeric(defense.safeties);
    add(`${safeties} safet${safeties === 1 ? "y" : "ies"}`, safeties * ruleValue(rules, "safety", position));
    const pointsAllowed = numeric(defense.ptsAgainst ?? defense.ptsAllowed);
    if (pointsAllowed === 0) add("0 points allowed", ruleValue(rules, "points_allowed_0", position));
    else if (pointsAllowed <= 6) add(`${pointsAllowed} points allowed (1-6)`, ruleValue(rules, "points_allowed_1_6", position));
    else if (pointsAllowed <= 13) add(`${pointsAllowed} points allowed (7-13)`, ruleValue(rules, "points_allowed_7_13", position));
    else if (pointsAllowed <= 20) add(`${pointsAllowed} points allowed (14-20)`, ruleValue(rules, "points_allowed_14_20", position));
  }
  return items;
}
function calculateCvcFantasyPoints(stats, position, rules) {
  const points = calculateCvcFantasyPointsBreakdown(stats, position, rules).reduce((total, item) => total + item.points, 0);
  return Math.round(points * 100) / 100;
}

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

// shared/nflTeamCodes.ts
var TEAM_CODE_ALIASES = {
  JAX: "JAC",
  KAN: "KC",
  TAM: "TB",
  ARZ: "ARI",
  WAS: "WSH",
  WSN: "WSH",
  OAK: "LV",
  LA: "LAR"
  // nflverse's roster CSV uses "LA" for the Rams; unambiguous since
  // the Chargers are always "LAC" there, never "LA".
};
function normalizeNFLTeamCode(team) {
  const code = (team ?? "").trim().toUpperCase();
  return TEAM_CODE_ALIASES[code] ?? code;
}

// server/dstSeasonAggregation.ts
var numeric2 = (value) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};
async function foldWeekIntoTotals(adapter2, week, year, rules, totals) {
  const games = await adapter2.listGamesForWeek(week, year);
  for (const game of games) {
    if (!game.gameID) continue;
    let box;
    try {
      box = await adapter2.getBoxScore(game.gameID);
    } catch {
      continue;
    }
    for (const [rawTeam, rawStats] of Object.entries(box.teamStats ?? {})) {
      const team = normalizeNFLTeamCode(rawTeam);
      if (!team || team === "FA") continue;
      const stats = rawStats;
      const fantasyPoints = calculateCvcFantasyPoints({ Defense: stats }, "DST", rules);
      const current = totals.get(team) ?? { gamesPlayed: 0, sacks: 0, defInt: 0, defTd: 0, fantasyPoints: 0 };
      totals.set(team, {
        gamesPlayed: current.gamesPlayed + 1,
        sacks: current.sacks + numeric2(stats.sacks),
        defInt: current.defInt + numeric2(stats.defensiveInterceptions ?? stats.interceptions),
        defTd: current.defTd + numeric2(stats.defTD ?? stats.defensiveOrSpecialTeamsTds),
        fantasyPoints: current.fantasyPoints + fantasyPoints
      });
    }
  }
}
async function aggregateDstSeasonStats(seasonId, year, throughWeek) {
  const adapter2 = getNFLDataAdapter();
  if (!(adapter2 instanceof Tank01NFLDataAdapter)) return { status: "skipped", reason: "Tank01 is not configured.", weeksProcessed: 0, teamsUpdated: 0 };
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", seasonId)) ?? [];
  if (!rules.length) return { status: "skipped", reason: "No scoring rules configured for this season.", weeksProcessed: 0, teamsUpdated: 0 };
  const totals = /* @__PURE__ */ new Map();
  let weeksProcessed = 0;
  for (let week = 1; week <= throughWeek; week += 1) {
    try {
      await foldWeekIntoTotals(adapter2, week, year, rules, totals);
      weeksProcessed += 1;
    } catch {
    }
  }
  const dstPlayers = unwrap(await supabase.from("player").select("id, nfl_team").eq("position", "DST")) ?? [];
  let teamsUpdated = 0;
  for (const player of dstPlayers) {
    const totalsForTeam = totals.get(normalizeNFLTeamCode(player.nfl_team ?? "") ?? "");
    if (!totalsForTeam || !totalsForTeam.gamesPlayed) continue;
    const fantasyPoints = Math.round(totalsForTeam.fantasyPoints * 100) / 100;
    const fantasyPointsPerGame = Math.round(fantasyPoints / totalsForTeam.gamesPlayed * 100) / 100;
    unwrap(await supabase.from("player_season_stat").upsert({
      season_id: seasonId,
      player_id: player.id,
      games_played: totalsForTeam.gamesPlayed,
      sacks: totalsForTeam.sacks,
      def_int: totalsForTeam.defInt,
      def_td: totalsForTeam.defTd,
      fantasy_points: fantasyPoints,
      fantasy_points_per_game: fantasyPointsPerGame,
      provider: "Tank01",
      synced_at: (/* @__PURE__ */ new Date()).toISOString()
    }, { onConflict: "season_id,player_id" }).select("id").single());
    teamsUpdated += 1;
  }
  return { status: "completed", weeksProcessed, teamsUpdated };
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
async function runDstSeasonStatsSync(req, res) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) {
      res.json({ ok: true, status: "skipped", reason: "No current season found." });
      return;
    }
    const weeks = unwrap(await supabase.from("schedule_week").select("week_number, status").eq("season_id", season.id)) ?? [];
    const lastCompletedWeek = weeks.filter((week) => week.status === "final").reduce((max, week) => Math.max(max, week.week_number), 0);
    if (!lastCompletedWeek) {
      res.json({ ok: true, status: "skipped", reason: "No week has completed yet this season." });
      return;
    }
    const result = await aggregateDstSeasonStats(season.id, season.year, lastCompletedWeek);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("D/ST season stats sync failed", error);
    res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelScheduledDstSeasonStats.ts
async function handler(req, res) {
  return runDstSeasonStatsSync(req, res);
}
export {
  handler as default
};
