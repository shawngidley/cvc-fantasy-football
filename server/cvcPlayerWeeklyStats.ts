import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { supabase, unwrap } from "./supabase";

function numeric(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, string | number | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string | number | undefined> : {};
}

export type CvcWeeklyStatRow = {
  games_played: number;
  pass_yds: number | null; pass_td: number | null; pass_int: number | null;
  rush_att: number | null; rush_yds: number | null; rush_td: number | null;
  targets: number | null; receptions: number | null; rec_yds: number | null; rec_td: number | null;
  fg_made: number | null; xp_made: number | null;
  sacks: number | null; def_int: number | null; def_td: number | null;
  fantasy_points: number;
};

/** Extracts one week's stat row for a single player from their already-fetched (and
 * already-corrected -- ESPN kicker-yardage override, correct DST attribution, etc.)
 * live stat line, the exact same statLines Map weekly finalization uses to compute
 * that week's official matchup scores. Field names match player_season_stat's
 * existing shape exactly, so summing these rows across weeks reconstructs precisely
 * what player.seasonStats (the Lineup page's existing shape) already expects.
 *
 * games_played is 1 whenever a stat line exists at all for this player this week
 * (they had SOME real box score data, even if it summed to 0 fantasy points), 0 when
 * there's no stat line at all (bye, injury, inactive) -- set explicitly here rather
 * than trusted from any raw provider "games played" field, which is built for a
 * season aggregate and not confirmed reliable per-game. */
export function extractWeeklyStatRow(statLine: Tank01LiveStats | null | undefined, position: string, rules: CvcScoringRule[]): CvcWeeklyStatRow {
  if (!statLine) {
    return {
      games_played: 0,
      pass_yds: null, pass_td: null, pass_int: null,
      rush_att: null, rush_yds: null, rush_td: null,
      targets: null, receptions: null, rec_yds: null, rec_td: null,
      fg_made: null, xp_made: null,
      sacks: null, def_int: null, def_td: null,
      fantasy_points: 0,
    };
  }
  const passing = asRecord(statLine.Passing);
  const rushing = asRecord(statLine.Rushing);
  const receiving = asRecord(statLine.Receiving);
  const kicking = asRecord(statLine.Kicking);
  const defense = asRecord(statLine.Defense);
  return {
    games_played: 1,
    pass_yds: numeric(passing.passYds), pass_td: numeric(passing.passTD), pass_int: numeric(passing.int),
    rush_att: numeric(rushing.carries ?? rushing.rushAtt), rush_yds: numeric(rushing.rushYds), rush_td: numeric(rushing.rushTD),
    targets: numeric(receiving.targets), receptions: numeric(receiving.receptions), rec_yds: numeric(receiving.recYds), rec_td: numeric(receiving.recTD),
    fg_made: numeric(kicking.fgMade), xp_made: numeric(kicking.xpMade),
    sacks: numeric(defense.sacks), def_int: numeric(defense.defensiveInterceptions), def_td: numeric(defense.defensiveOrSpecialTeamsTds ?? defense.defTD),
    fantasy_points: calculateCvcFantasyPoints(statLine, position, rules),
  };
}

export type CvcSeasonStatsFromWeekly = {
  games_played: number;
  pass_yds: number | null; pass_td: number | null; pass_int: number | null;
  rush_att: number | null; rush_yds: number | null; rush_td: number | null;
  targets: number | null; receptions: number | null; rec_yds: number | null; rec_td: number | null;
  fg_made: number | null; xp_made: number | null;
  sacks: number | null; def_int: number | null; def_td: number | null;
  fantasy_points: number;
  fantasy_points_per_game: number | null;
};

const SUM_FIELDS = ["pass_yds", "pass_td", "pass_int", "rush_att", "rush_yds", "rush_td", "targets", "receptions", "rec_yds", "rec_td", "fg_made", "xp_made", "sacks", "def_int", "def_td"] as const;

/** Sums a player's weekly rows into a season total, matching player_season_stat's
 * existing shape exactly. Every field here is a simple sum (CVC currently has no
 * rate/percentage-style stat like a passer rating that would instead need averaging
 * only across weeks with actual activity -- if one gets added later, it needs its own
 * weeks-with-activity-only average here rather than being summed like these).
 *
 * fantasy_points_per_game divides by games_played (the sum of each week's explicit 0/1
 * flag), NOT by the number of rows passed in -- a bye week still gets a row (with
 * games_played: 0), and must not count toward that denominator, or a player who missed
 * time would show an artificially deflated per-game average. */
export function aggregateWeeklyStatsForSeason(weeklyRows: CvcWeeklyStatRow[]): CvcSeasonStatsFromWeekly {
  const gamesPlayed = weeklyRows.reduce((sum, row) => sum + row.games_played, 0);
  const fantasyPoints = Math.round(weeklyRows.reduce((sum, row) => sum + row.fantasy_points, 0) * 100) / 100;
  const summed: Record<string, number | null> = {};
  for (const field of SUM_FIELDS) {
    const values = weeklyRows.map(row => row[field]).filter((value): value is number => value !== null);
    summed[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return {
    games_played: gamesPlayed,
    pass_yds: summed.pass_yds, pass_td: summed.pass_td, pass_int: summed.pass_int,
    rush_att: summed.rush_att, rush_yds: summed.rush_yds, rush_td: summed.rush_td,
    targets: summed.targets, receptions: summed.receptions, rec_yds: summed.rec_yds, rec_td: summed.rec_td,
    fg_made: summed.fg_made, xp_made: summed.xp_made,
    sacks: summed.sacks, def_int: summed.def_int, def_td: summed.def_td,
    fantasy_points: fantasyPoints,
    fantasy_points_per_game: gamesPlayed > 0 ? Math.round((fantasyPoints / gamesPlayed) * 100) / 100 : null,
  };
}

/** Reads and aggregates a set of players' current-season stats from
 * cvc_player_weekly_stat, keyed by player_id -- the read side of the persist-once,
 * read-everywhere approach. Only players with at least one row are included in the
 * result (a player CVC has never finalized a week for yet -- a brand new addition, or
 * simply not yet reached by this season -- has nothing to aggregate). */
export async function readSeasonStatsFromWeekly(seasonId: string, playerIds: string[]): Promise<Map<string, CvcSeasonStatsFromWeekly>> {
  if (!playerIds.length) return new Map();
  const queryResult = await supabase.from("cvc_player_weekly_stat").select("player_id, games_played, pass_yds, pass_td, pass_int, rush_att, rush_yds, rush_td, targets, receptions, rec_yds, rec_td, fg_made, xp_made, sacks, def_int, def_td, fantasy_points").eq("season_id", seasonId).in("player_id", playerIds);
  const rows = queryResult.error ? [] : (queryResult.data ?? []); // e.g. this table's migration hasn't been run yet -- the caller already treats "nothing to aggregate" as a normal case, not an error
  const byPlayer = new Map<string, CvcWeeklyStatRow[]>();
  for (const row of rows) {
    const existing = byPlayer.get(row.player_id) ?? [];
    existing.push(row as CvcWeeklyStatRow);
    byPlayer.set(row.player_id, existing);
  }
  const result = new Map<string, CvcSeasonStatsFromWeekly>();
  for (const [playerId, playerRows] of Array.from(byPlayer)) result.set(playerId, aggregateWeeklyStatsForSeason(playerRows));
  return result;
}

export type WeeklyStatPlayer = { id: string; display_name: string; position: string | null; nfl_team: string | null };

/** Persists one row per rostered player (starters AND bench -- the Lineup page shows
 * season stats for bench players too, so this has to cover the whole roster, not just
 * who started that specific week) for a finalized week. Called once, right after
 * weekly finalization computes that week's official scores, from the exact same data
 * -- so this never drifts from what finalization itself already decided a player
 * scored. Upserts on (schedule_week_id, player_id), so a forced re-finalization of an
 * already-processed week safely overwrites with corrected data rather than creating
 * duplicate rows. */
export async function persistWeeklyStats(params: {
  seasonId: string;
  scheduleWeekId: string;
  weekNumber: number;
  players: WeeklyStatPlayer[];
  statLines: Map<string, Tank01LiveStats>;
  statLineKeyFor: (player: WeeklyStatPlayer) => string;
  rules: CvcScoringRule[];
}): Promise<{ rowsWritten: number }> {
  const { seasonId, scheduleWeekId, weekNumber, players, statLines, statLineKeyFor, rules } = params;
  const seen = new Set<string>();
  const rows = players.filter(player => {
    if (seen.has(player.id)) return false; // a player can appear on multiple snapshot rows in rare cases (e.g. a mid-week slot change); one row per player per week
    seen.add(player.id);
    return true;
  }).map(player => {
    const position = player.position === "DEF" ? "DST" : player.position ?? "";
    const statLine = statLines.get(statLineKeyFor(player));
    const row = extractWeeklyStatRow(statLine, position, rules);
    return { season_id: seasonId, schedule_week_id: scheduleWeekId, week_number: weekNumber, player_id: player.id, position, nfl_team: player.nfl_team, ...row };
  });
  if (!rows.length) return { rowsWritten: 0 };
  const result = await supabase.from("cvc_player_weekly_stat").upsert(rows, { onConflict: "schedule_week_id,player_id" });
  if (result.error) return { rowsWritten: 0 }; // e.g. this table's migration hasn't been run yet -- never blocks weekly finalization itself, which this is called from
  return { rowsWritten: rows.length };
}
