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

// server/nflTeamAssignmentSync.ts
import { parse } from "csv-parse/sync";

// server/fantasyProsArchive.ts
import { createHash } from "node:crypto";
var ARCHIVE_RETENTION_DAYS = 30;
var ELIGIBLE_FANTASY_NEWS_POSITIONS = /* @__PURE__ */ new Set(["QB", "RB", "WR", "TE", "K"]);
function isEligibleFantasyProsNews(item) {
  return Boolean(item.playerName && item.title && item.position && ELIGIBLE_FANTASY_NEWS_POSITIONS.has(item.position));
}
function fantasyProsArchiveKey(item) {
  const stableSource = item.id || `${item.playerId ?? "no-player"}|${item.title}|${item.published}`;
  return createHash("sha256").update(`fantasypros|${stableSource}`).digest("hex");
}
function asDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
async function archiveFantasyProsNews(items) {
  const now = /* @__PURE__ */ new Date();
  const rows = items.filter(isEligibleFantasyProsNews).map((item) => {
    const publishedAt = asDate(item.published);
    if (!publishedAt) return null;
    const expiresAt = new Date(publishedAt.getTime() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
    if (expiresAt <= now) return null;
    return {
      archive_key: fantasyProsArchiveKey(item),
      source: "FantasyPros",
      source_item_id: item.id ? String(item.id) : null,
      player_id: item.playerId,
      player_name: item.playerName,
      team: item.team || null,
      position: item.position || null,
      title: item.title,
      description: item.description || null,
      impact: item.impact || null,
      author: item.author || null,
      article_url: item.link || null,
      published_at: publishedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      captured_at: now.toISOString()
    };
  }).filter((row) => Boolean(row));
  if (rows.length) unwrap(await supabase.from("cvc_fantasypros_news_archive").upsert(rows, { onConflict: "archive_key" }));
  const pruned = unwrap(await supabase.from("cvc_fantasypros_news_archive").delete().lt("expires_at", now.toISOString()).select("id"));
  unwrap(await supabase.from("cvc_fantasypros_news_archive_config").upsert({
    id: "rolling-archive",
    retention_days: ARCHIVE_RETENTION_DAYS,
    last_collected_at: now.toISOString(),
    updated_at: now.toISOString()
  }, { onConflict: "id" }).select("id").single());
  return { archived: rows.length, pruned: pruned?.length ?? 0 };
}

// server/fantasyProsNewsNames.ts
function attachFantasyProsPlayerNames(items, ranks) {
  const ranksById = new Map(ranks.filter((rank) => rank.playerId && rank.name).map((rank) => [rank.playerId, rank]));
  return items.map((item) => {
    const rank = item.playerId == null ? void 0 : ranksById.get(item.playerId);
    if (!rank) return item;
    return {
      ...item,
      playerName: item.playerName || rank.name,
      team: item.team || rank.team,
      position: item.position || rank.position
    };
  });
}

// server/fantasyProsNews.ts
var FEED_BASE = "https://wrcfantasyfootball.com/api/fantasypros/feed";
var LOCAL_CACHE_TTL_MS = 5 * 6e4;
var cache = /* @__PURE__ */ new Map();
async function requestFeed(key) {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const secret2 = process.env.FANTASYPROS_FEED_SECRET;
  if (!secret2) {
    console.warn(`[FantasyPros feed] FANTASYPROS_FEED_SECRET is not configured -- returning an empty result for key "${key}".`);
    return null;
  }
  try {
    const response = await fetch(`${FEED_BASE}?key=${encodeURIComponent(key)}`, {
      headers: { "x-feed-secret": secret2 },
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) {
      console.warn(`[FantasyPros feed] Request for key "${key}" failed with status ${response.status} -- returning an empty result.`);
      return null;
    }
    const row = await response.json();
    const value = asRecord(row).payload ?? null;
    cache.set(key, { value, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn(`[FantasyPros feed] Request for key "${key}" threw -- returning an empty result.`, error instanceof Error ? error.message : error);
    return null;
  }
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
async function getFantasyProsNews(limit = 50) {
  const data = asRecord(await requestFeed("news"));
  const items = asArray(data.items).map((item) => {
    const row = asRecord(item);
    return {
      id: asNumber(row.id) ?? 0,
      playerId: asNumber(row.player_id),
      playerName: asString(row.player_name ?? row.name),
      team: asString(row.team_id),
      title: asString(row.title),
      description: asString(row.desc),
      impact: asString(row.impact),
      author: asString(row.author),
      published: asString(row.created),
      link: asString(row.link)
    };
  }).filter((item) => item.title);
  return items.slice(0, Math.min(Math.max(limit, 1), 100));
}
async function getFantasyProsRanks(year, position, week) {
  if (position === "OP") return [];
  const data = asRecord(await requestFeed(`ranks:${position}:week:${week}`));
  return asArray(data.players).map((item) => {
    const row = asRecord(item);
    return {
      playerId: asNumber(row.player_id) ?? 0,
      name: asString(row.player_name),
      team: asString(row.player_team_id),
      position: asString(row.player_position_id),
      ecr: asNumber(row.rank_ecr),
      positionRank: asString(row.pos_rank),
      tier: asNumber(row.tier),
      byeWeek: asNumber(row.player_bye_week)
    };
  }).filter((item) => item.name);
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
async function runFantasyProsArchiveCollection(req, res) {
  if (!checkCronAuth(req, res)) return;
  try {
    const season = await getCurrentSeason();
    if (!season) {
      res.json({ ok: true, status: "skipped", reason: "No current season found." });
      return;
    }
    const eligible = ["QB", "RB", "WR", "TE", "K"];
    const [news, ...rankGroups] = await Promise.all([
      getFantasyProsNews(100),
      ...eligible.map((position) => getFantasyProsRanks(season.year, position, 1))
    ]);
    const result = await archiveFantasyProsNews(attachFantasyProsPlayerNames(news, rankGroups.flat()));
    res.json({ ok: true, fetched: news.length, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("FantasyPros archive collection failed", error);
    res.status(500).json({ error: message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// server/_core/vercelScheduledFantasyProsArchive.ts
async function handler(req, res) {
  return runFantasyProsArchiveCollection(req, res);
}
export {
  handler as default
};
