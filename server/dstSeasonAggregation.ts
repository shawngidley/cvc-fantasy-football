import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { normalizeNFLTeamCode } from "@shared/nflTeamCodes";
import { getNFLDataAdapter, Tank01NFLDataAdapter, type Tank01BoxScore } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

export type DstWeeklyTotal = { gamesPlayed: number; sacks: number; defInt: number; defTd: number; fantasyPoints: number };

const numeric = (value: unknown): number => { const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0")); return Number.isFinite(parsed) ? parsed : 0; };

/** Fetches every completed game in one week and folds each team's defensive box-score
 * line into the running totals map. Crucially, fantasyPoints for that team's game is
 * computed via a single call to calculateCvcFantasyPoints on that game's own Defense
 * stats -- the same call tank01ScoringSync.ts's live scoring already makes -- so the
 * points-allowed tier bonus (0/1-6/7-13/14-20, confirmed: 21+ gets no bonus or penalty
 * under CVC's actual rules) is correctly evaluated per game and then summed, rather
 * than trying to bucket a season-total points-allowed average, which would be wrong:
 * a team that allows exactly 17 every week and a team that alternates 0 and 34 have
 * the same season average but very different real per-game bonuses. */
async function foldWeekIntoTotals(adapter: Tank01NFLDataAdapter, week: number, year: number, rules: CvcScoringRule[], totals: Map<string, DstWeeklyTotal>): Promise<void> {
  const games = await adapter.listGamesForWeek(week, year);
  for (const game of games) {
    if (!game.gameID) continue;
    let box: Tank01BoxScore;
    try { box = await adapter.getBoxScore(game.gameID) as Tank01BoxScore; } catch { continue; } // one bad game shouldn't abort the whole week
    for (const [rawTeam, rawStats] of Object.entries(box.teamStats ?? {})) {
      const team = normalizeNFLTeamCode(rawTeam);
      if (!team || team === "FA") continue;
      const stats = rawStats as Record<string, unknown>;
      const fantasyPoints = calculateCvcFantasyPoints({ Defense: stats } as Tank01LiveStats, "DST", rules);
      const current = totals.get(team) ?? { gamesPlayed: 0, sacks: 0, defInt: 0, defTd: 0, fantasyPoints: 0 };
      totals.set(team, {
        gamesPlayed: current.gamesPlayed + 1,
        sacks: current.sacks + numeric(stats.sacks),
        defInt: current.defInt + numeric(stats.defensiveInterceptions ?? stats.interceptions),
        defTd: current.defTd + numeric(stats.defTD ?? stats.defensiveOrSpecialTeamsTds),
        fantasyPoints: current.fantasyPoints + fantasyPoints,
      });
    }
  }
}

export type DstAggregationSummary = { status: "skipped" | "completed"; reason?: string; weeksProcessed: number; teamsUpdated: number };

/** Aggregates DST season stats week-by-week for weeks 1..throughWeek of the given year,
 * and upserts the results into player_season_stat for every DST player whose nfl_team
 * matches. Safe to re-run for the same year/throughWeek (upserts, not inserts) -- e.g.
 * call with an increasing throughWeek as each new week of 2026 completes, or once with
 * throughWeek=18 to backfill a fully completed season like 2025. */
export async function aggregateDstSeasonStats(seasonId: string, year: number, throughWeek: number): Promise<DstAggregationSummary> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) return { status: "skipped", reason: "Tank01 is not configured.", weeksProcessed: 0, teamsUpdated: 0 };
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", seasonId)) ?? [];
  if (!rules.length) return { status: "skipped", reason: "No scoring rules configured for this season.", weeksProcessed: 0, teamsUpdated: 0 };

  const totals = new Map<string, DstWeeklyTotal>();
  let weeksProcessed = 0;
  for (let week = 1; week <= throughWeek; week += 1) {
    try { await foldWeekIntoTotals(adapter, week, year, rules, totals); weeksProcessed += 1; } catch { /* a whole missing/future week just contributes nothing */ }
  }

  const dstPlayers = unwrap(await supabase.from("player").select("id, nfl_team").eq("position", "DST")) ?? [];
  let teamsUpdated = 0;
  for (const player of dstPlayers) {
    const totalsForTeam = totals.get(normalizeNFLTeamCode(player.nfl_team ?? "") ?? "");
    if (!totalsForTeam || !totalsForTeam.gamesPlayed) continue;
    const fantasyPoints = Math.round(totalsForTeam.fantasyPoints * 100) / 100;
    const fantasyPointsPerGame = Math.round((fantasyPoints / totalsForTeam.gamesPlayed) * 100) / 100;
    unwrap(await supabase.from("player_season_stat").upsert({
      season_id: seasonId, player_id: player.id, games_played: totalsForTeam.gamesPlayed,
      sacks: totalsForTeam.sacks, def_int: totalsForTeam.defInt, def_td: totalsForTeam.defTd,
      fantasy_points: fantasyPoints, fantasy_points_per_game: fantasyPointsPerGame,
      provider: "Tank01", synced_at: new Date().toISOString(),
    }, { onConflict: "season_id,player_id" }).select("id").single());
    teamsUpdated += 1;
  }
  return { status: "completed", weeksProcessed, teamsUpdated };
}
