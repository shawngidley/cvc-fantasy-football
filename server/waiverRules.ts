import { supabase, unwrap } from "./supabase";

/** CVC's actual season-long waiver rules (per commissioner, Sept 2026). */
export const STARTING_FAAB = 30;
export const MIN_ROSTER_SIZE = 15;
export const MAX_ROSTER_SIZE = 22;

/** Remaining season FAAB budget for a franchise: STARTING_FAAB minus every 'won' bid
 * amount this season, across every waiver period (bid-cycle or free-period alike --
 * free-period wins are always $1, which still counts against the season cap). */
export async function getFaabBalance(franchiseId: string, seasonId: string): Promise<number> {
  const periodIds = (unwrap(await supabase.from("waiver_period").select("id").eq("season_id", seasonId)) ?? []).map(period => period.id);
  if (!periodIds.length) return STARTING_FAAB;
  const spent = (unwrap(await supabase.from("faab_bid").select("amount").eq("franchise_id", franchiseId).eq("status", "won").in("waiver_period_id", periodIds)) ?? []).reduce((total, bid) => total + bid.amount, 0);
  return STARTING_FAAB - spent;
}

export type FranchiseStanding = { franchiseId: string; wins: number; losses: number; pointsFor: number };

/** Wins/losses/points-for per franchise from final matchups this season, used for the
 * "worst record wins the tie" rule (fewest wins first, then fewest points-for). Same
 * computation as the overview procedure's standings logic, factored out so the waiver
 * resolution engine doesn't duplicate it. */
export async function computeFranchiseStandings(seasonId: string): Promise<Map<string, FranchiseStanding>> {
  const weeks = unwrap(await supabase.from("schedule_week").select("id").eq("season_id", seasonId)) ?? [];
  const weekIds = weeks.map(week => week.id);
  const franchises = unwrap(await supabase.from("franchise").select("id").eq("is_active", true)) ?? [];
  const standings = new Map<string, FranchiseStanding>(franchises.map(franchise => [franchise.id, { franchiseId: franchise.id, wins: 0, losses: 0, pointsFor: 0 }]));
  if (!weekIds.length) return standings;
  const matchups = unwrap(await supabase.from("matchup").select("home_franchise_id, away_franchise_id, home_score, away_score, result_state").in("schedule_week_id", weekIds).eq("result_state", "final")) ?? [];
  for (const matchup of matchups) {
    const home = standings.get(matchup.home_franchise_id);
    const away = standings.get(matchup.away_franchise_id);
    if (!home || !away) continue;
    const homeScore = Number(matchup.home_score);
    const awayScore = Number(matchup.away_score);
    home.pointsFor += homeScore;
    away.pointsFor += awayScore;
    if (homeScore > awayScore) { home.wins += 1; away.losses += 1; }
    else if (awayScore > homeScore) { away.wins += 1; home.losses += 1; }
  }
  return standings;
}

/** Sorts franchise ids "worst record first" for tie-breaking equal bids: fewest wins
 * first, then fewest points-for. A franchise with no games yet (0-0-0) is treated as
 * the worst possible record, consistent with "worst record wins the tie" intent. */
export function sortByWorstRecordFirst(franchiseIds: string[], standings: Map<string, FranchiseStanding>): string[] {
  return [...franchiseIds].sort((a, b) => {
    const sa = standings.get(a) ?? { wins: 0, losses: 0, pointsFor: 0 };
    const sb = standings.get(b) ?? { wins: 0, losses: 0, pointsFor: 0 };
    if (sa.wins !== sb.wins) return sa.wins - sb.wins;
    return sa.pointsFor - sb.pointsFor;
  });
}
