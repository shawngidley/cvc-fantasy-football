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
  if (!stats) return [];
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

// server/fantasyProsNews.ts
var LOCAL_CACHE_TTL_MS = 5 * 6e4;

// server/playerCareerStats.ts
var ESPN_GAMELOG = "https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes";
function buildLabelMap(labels) {
  const map = {};
  const seen = {};
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const count = seen[label] ?? 0;
    seen[label] = count + 1;
    map[`${label}_${count}`] = i;
    if (count === 0) map[label] = i;
  }
  return map;
}
function sumGameStats(events, labelMap) {
  const totals = {};
  for (const event of events) {
    const stats = event.stats ?? [];
    for (const [label, index] of Object.entries(labelMap)) {
      totals[label] = (totals[label] ?? 0) + (Number.parseFloat(stats[index] ?? "0") || 0);
    }
  }
  return totals;
}
function extractFromGamelog(totals, gp, labels) {
  const row = { gp };
  const labelMap = buildLabelMap(labels);
  const totalAtLabelIndex = (targetIndex, label) => {
    const occurrence = labels.slice(0, targetIndex).filter((previous) => previous === label).length;
    return totals[`${label}_${occurrence}`] ?? totals[label] ?? 0;
  };
  const valueAfter = (anchor, label) => {
    const anchorIndex = labelMap[anchor];
    if (anchorIndex === void 0) return 0;
    for (let index = anchorIndex + 1; index < labels.length; index += 1) {
      if (labels[index] === label) return totalAtLabelIndex(index, label);
    }
    return 0;
  };
  if ("CMP" in labelMap) {
    row.passCmp = totals.CMP ?? 0;
    row.passAtt = totals.ATT ?? 0;
    row.passYds = valueAfter("CMP", "YDS");
    row.passTD = valueAfter("CMP", "TD");
    row.passInt = totals.INT ?? 0;
    row.passCmpPct = row.passAtt > 0 ? Math.round(row.passCmp / row.passAtt * 1e3) / 10 : 0;
    row.rushAtt = totals.CAR ?? 0;
    row.rushYds = valueAfter("CAR", "YDS");
    row.rushTD = valueAfter("CAR", "TD");
    row.rushAvg = row.rushAtt > 0 ? Math.round(row.rushYds / row.rushAtt * 10) / 10 : 0;
  }
  if ("CAR" in labelMap && !("CMP" in labelMap)) {
    row.rushAtt = totals.CAR ?? 0;
    row.rushYds = valueAfter("CAR", "YDS");
    row.rushTD = valueAfter("CAR", "TD");
    row.rushAvg = row.rushAtt > 0 ? Math.round(row.rushYds / row.rushAtt * 10) / 10 : 0;
  }
  if ("REC" in labelMap) {
    row.rec = totals.REC ?? 0;
    row.recTargets = totals.TGTS ?? 0;
    row.recYds = valueAfter("REC", "YDS");
    row.recTD = valueAfter("REC", "TD");
    row.recAvg = row.rec > 0 ? Math.round(row.recYds / row.rec * 10) / 10 : 0;
  }
  if ("FGM" in labelMap) {
    row.fgMade = totals.FGM ?? 0;
    row.fgAtt = totals.FGA ?? 0;
    row.fgPct = row.fgAtt > 0 ? Math.round(row.fgMade / row.fgAtt * 1e3) / 10 : 0;
    row.xpMade = totals.XPM ?? 0;
    row.xpAtt = totals.XPA ?? 0;
  }
  if ("SACK" in labelMap && !("CMP" in labelMap)) {
    row.sacks = totals.SACK ?? 0;
    row.defInt = totals.INT ?? 0;
    row.fumblesRecovered = totals.FR ?? 0;
    row.defTD = totals.TD ?? 0;
  }
  return row;
}
function toCvcStatsShape(row) {
  return {
    Passing: { passYds: row.passYds ?? 0, passTD: row.passTD ?? 0, int: row.passInt ?? 0 },
    Rushing: { rushYds: row.rushYds ?? 0, rushTD: row.rushTD ?? 0 },
    Receiving: { recYds: row.recYds ?? 0, recTD: row.recTD ?? 0, receptions: row.rec ?? 0 },
    Kicking: { xpMade: row.xpMade ?? 0 },
    Defense: { sacks: row.sacks ?? 0, defensiveInterceptions: row.defInt ?? 0, defTD: row.defTD ?? 0, fumblesRecovered: row.fumblesRecovered ?? 0 }
  };
}
async function fetchOneSeason(espnId, year, position, rules) {
  const response = await fetch(`${ESPN_GAMELOG}/${espnId}/gamelog?season=${year}`, { signal: AbortSignal.timeout(15e3) });
  if (!response.ok) return null;
  const data = await response.json();
  const labels = data.labels ?? [];
  if (!labels.length) return null;
  let events = [];
  for (const seasonType of data.seasonTypes ?? []) {
    for (const category of seasonType.categories ?? []) {
      const candidateEvents = category.events ?? [];
      if (candidateEvents.length > events.length) events = candidateEvents;
    }
  }
  if (!events.length) return null;
  const totals = sumGameStats(events, buildLabelMap(labels));
  const extracted = extractFromGamelog(totals, events.length, labels);
  const cvcPts = calculateCvcFantasyPoints(toCvcStatsShape(extracted), position, rules);
  const gp = extracted.gp ?? 0;
  return { season: year, gp, ...extracted, cvcPts: Math.round(cvcPts * 100) / 100, cvcPtsPerGame: gp > 0 ? Math.round(cvcPts / gp * 100) / 100 : 0 };
}
async function getCvcPlayerCareerStats(espnId, position, rules, currentYear, yearsBack = 5) {
  const years = Array.from({ length: yearsBack }, (_, index) => currentYear - index);
  const results = await Promise.all(years.map((year) => fetchOneSeason(espnId, year, position, rules).catch(() => null)));
  return results.filter((row) => row !== null).sort((a, b) => b.season - a.season);
}
function toCvcSeasonStatsShape(row) {
  return {
    games_played: row.gp,
    pass_yds: row.passYds ?? null,
    pass_td: row.passTD ?? null,
    pass_int: row.passInt ?? null,
    rush_att: row.rushAtt ?? null,
    rush_yds: row.rushYds ?? null,
    rush_td: row.rushTD ?? null,
    targets: row.recTargets ?? null,
    receptions: row.rec ?? null,
    rec_yds: row.recYds ?? null,
    rec_td: row.recTD ?? null,
    fg_made: row.fgMade ?? null,
    xp_made: row.xpMade ?? null,
    sacks: row.sacks ?? null,
    def_int: row.defInt ?? null,
    def_td: row.defTD ?? null,
    fantasy_points: row.cvcPts,
    fantasy_points_per_game: row.cvcPtsPerGame
  };
}

// server/cvcSeasonStatsHistorical.ts
var ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];
var CONCURRENCY = 10;
function extractEspnId(row) {
  const raw = row.espnID ?? row.espnId;
  return raw !== void 0 && raw !== null ? String(raw) : null;
}
async function backfillHistoricalSeasonStats(year, limit = 40, timeBudgetMs = 26e4) {
  const startedAt = Date.now();
  const adapter2 = getNFLDataAdapter();
  if (!(adapter2 instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured for the historical stats backfill.");
  const players = unwrap(await supabase.from("player").select("id, display_name, position, metadata").neq("provider", "placeholder").in("position", ELIGIBLE_POSITIONS).order("display_name")) ?? [];
  if (!players.length) return { status: "completed", attempted: 0, updated: 0, notFound: 0, remaining: 0 };
  const existing = unwrap(await supabase.from("cvc_season_stats_historical").select("player_id").eq("year", year)) ?? [];
  const alreadyBackfilled = new Set(existing.map((row) => row.player_id));
  const pending = players.filter((player) => !alreadyBackfilled.has(player.id));
  const batch = pending.slice(0, limit);
  const currentSeason = unwrap(await supabase.from("season").select("id").eq("is_current", true).limit(1).maybeSingle()) ?? unwrap(await supabase.from("season").select("id").order("year", { ascending: false }).limit(1).maybeSingle());
  const rules = currentSeason ? unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", currentSeason.id)) ?? [] : [];
  let attempted = 0;
  let updated = 0;
  let notFound = 0;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    const chunk = batch.slice(i, i + CONCURRENCY);
    attempted += chunk.length;
    await Promise.all(chunk.map(async (player) => {
      try {
        const tank01Id = player.metadata?.tank01_id ? String(player.metadata.tank01_id) : null;
        const byId = tank01Id ? await adapter2.getPlayerInfoById(tank01Id).catch(() => null) : null;
        const infoRow = byId ?? await adapter2.getPlayerInfo(player.display_name).catch(() => null);
        const espnId = infoRow ? extractEspnId(infoRow) : null;
        if (!espnId) {
          notFound += 1;
          return;
        }
        const seasons = await getCvcPlayerCareerStats(espnId, player.position ?? "", rules, year, 1);
        const row = seasons.find((candidate) => candidate.season === year);
        if (!row) {
          notFound += 1;
          return;
        }
        unwrap(await supabase.from("cvc_season_stats_historical").upsert({
          year,
          player_id: player.id,
          ...toCvcSeasonStatsShape(row),
          backfilled_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "year,player_id" }).select("id").single());
        updated += 1;
      } catch {
        notFound += 1;
      }
    }));
  }
  return { status: pending.length > attempted ? "in_progress" : "completed", attempted, updated, notFound, remaining: pending.length - attempted };
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
async function runHistoricalSeasonStatsBackfill(req, res) {
  if (!checkCronAuth(req, res)) return;
  try {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2e3 || year > 2100) {
      res.status(400).json({ error: "A valid ?year= query parameter is required." });
      return;
    }
    const result = await backfillHistoricalSeasonStats(year, 1e3);
    res.json({ ok: true, year, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Historical season stats backfill failed", error);
    res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelScheduledHistoricalSeasonStats.ts
async function handler(req, res) {
  return runHistoricalSeasonStatsBackfill(req, res);
}
export {
  handler as default
};
