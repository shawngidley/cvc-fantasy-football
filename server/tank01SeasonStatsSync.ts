import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const CONCURRENCY = 5;

type CvcPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null };

export type SeasonStatsSyncSummary = {
  status: "skipped" | "completed";
  reason?: string;
  attempted: number;
  updated: number;
  notFound: number;
  remaining: number;
  teamsUpdated: number;
};

const numeric = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

function asRecord(value: unknown): Record<string, string | number | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string | number | undefined> : {};
}

// Tank01 field name for the team abbreviation isn't confirmed against a live response in
// this codebase, so check several plausible keys defensively (matching the cautious style
// already used for other unverified Tank01 fields, e.g. useTeamSchedule's comment in
// CvcWrcPlayerProfile.tsx) and simply leave nfl_team unchanged if none are present.
export function extractCurrentTeam(row: Record<string, unknown>): string | null {
  const raw = row.team ?? row.teamAbv ?? row.currentTeam ?? row.team_abv ?? row.nflTeam;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().toUpperCase();
  return value && value !== "FA" ? value : null;
}

/** Tank01's getNFLPlayerInfo?getStats=true nests season-total categories under `stats`
 * (falling back to the row itself if the shape differs). This is the SAME endpoint the
 * player profile page already calls client-side per player — reused here server-side
 * so results can be cached instead of re-fetched on every page view. */
function extractSeasonStats(row: Record<string, unknown>, position: string, rules: CvcScoringRule[]) {
  const statsBlob = asRecord(row.stats);
  const flat = Object.keys(statsBlob).length ? statsBlob : row;
  const passing = asRecord(flat.Passing);
  const rushing = asRecord(flat.Rushing);
  const receiving = asRecord(flat.Receiving);
  const kicking = asRecord(flat.Kicking);
  const defense = asRecord(flat.Defense);
  const gamesPlayed = numeric(flat.gamesPlayed ?? flat.gamesPlayedTotal ?? flat.gp);

  // DST season fantasy points intentionally excludes CVC's per-game "points allowed"
  // bucket bonus (0/1-6/7-13/14-20) — that scoring is only meaningful per game, and
  // Tank01's season total here is points allowed across the whole season, not one
  // game, so applying the bucket to it would produce a meaningless number. Season
  // FPTS for DST below is turnovers/sacks/TDs only until a weekly aggregation exists.
  const seasonStatsForScoring: Tank01LiveStats = { Passing: passing, Rushing: rushing, Receiving: receiving, Kicking: kicking, Defense: position === "DST" ? { ...defense, ptsAgainst: undefined } : defense };
  const fantasyPoints = calculateCvcFantasyPoints(seasonStatsForScoring, position, rules);
  const fantasyPointsPerGame = gamesPlayed && gamesPlayed > 0 ? Math.round((fantasyPoints / gamesPlayed) * 100) / 100 : null;

  return {
    games_played: gamesPlayed,
    pass_yds: numeric(passing.passYds), pass_td: numeric(passing.passTD), pass_int: numeric(passing.int),
    rush_att: numeric(rushing.carries ?? rushing.rushAtt), rush_yds: numeric(rushing.rushYds), rush_td: numeric(rushing.rushTD),
    targets: numeric(receiving.targets), receptions: numeric(receiving.receptions), rec_yds: numeric(receiving.recYds), rec_td: numeric(receiving.recTD),
    fg_made: numeric(kicking.fgMade), xp_made: numeric(kicking.xpMade),
    sacks: numeric(defense.sacks), def_int: numeric(defense.defensiveInterceptions), def_td: numeric(defense.defTD ?? defense.defensiveOrSpecialTeamsTds),
    fantasy_points: fantasyPoints, fantasy_points_per_game: fantasyPointsPerGame,
  };
}

/** Commissioner-triggered, resumable batch sync (not a Vercel Cron job — a full pool
 * sync would exceed a single serverless invocation's time budget). Each call processes
 * up to `limit` not-yet-synced-today players, writing each result immediately so
 * partial progress persists even if the batch is interrupted. Call repeatedly
 * (see `remaining` in the summary) until the whole pool is covered. */
export async function syncTank01SeasonStats(seasonId: string, limit = 40): Promise<SeasonStatsSyncSummary> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", reason: "Tank01 is not configured.", attempted: 0, updated: 0, notFound: 0, remaining: 0, teamsUpdated: 0 };

  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", seasonId)) ?? [];
  const players = unwrap(await supabase.from("player").select("id, display_name, position, nfl_team").neq("provider", "placeholder").in("position", ELIGIBLE_POSITIONS).order("display_name")) as CvcPlayer[] ?? [];
  if (!players.length) return { status: "completed", attempted: 0, updated: 0, notFound: 0, remaining: 0, teamsUpdated: 0 };

  const staleCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const existing = unwrap(await supabase.from("player_season_stat").select("player_id, synced_at").eq("season_id", seasonId)) ?? [];
  const freshPlayerIds = new Set(existing.filter(row => row.synced_at > staleCutoff).map(row => row.player_id));
  const pending = players.filter(player => !freshPlayerIds.has(player.id));
  const batch = pending.slice(0, limit);

  let updated = 0;
  let notFound = 0;
  let teamsUpdated = 0;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async player => {
      try {
        const row = await adapter.getPlayerInfo(player.display_name);
        if (!row) { notFound += 1; return; }
        const stats = extractSeasonStats(row as Record<string, unknown>, player.position ?? "", rules);
        unwrap(await supabase.from("player_season_stat").upsert({ season_id: seasonId, player_id: player.id, ...stats, provider: "Tank01", synced_at: new Date().toISOString() }, { onConflict: "season_id,player_id" }).select("id").single());
        // Keeps the Rosters/Lineup/Free Agents pages current after real-world trades or
        // signings, using the same Tank01 call already made above for stats — no extra
        // API cost. Skipped for DST rows: their "player" record IS the team itself
        // (e.g. "Los Angeles Rams"), so there's no separate current-team concept to sync.
        if (player.position !== "DST") {
          const currentTeam = extractCurrentTeam(row as Record<string, unknown>);
          if (currentTeam && currentTeam !== (player.nfl_team ?? "").toUpperCase()) {
            unwrap(await supabase.from("player").update({ nfl_team: currentTeam }).eq("id", player.id).select("id").single());
            teamsUpdated += 1;
          }
        }
        updated += 1;
      } catch { notFound += 1; }
    }));
  }
  return { status: "completed", attempted: batch.length, updated, notFound, remaining: Math.max(0, pending.length - batch.length), teamsUpdated };
}
