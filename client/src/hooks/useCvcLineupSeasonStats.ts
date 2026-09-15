import { trpc } from "@/lib/trpc";

export type CvcLineupSeasonStats = {
  games_played: number | null;
  pass_yds: number | null; pass_td: number | null; pass_int: number | null;
  rush_att: number | null; rush_yds: number | null; rush_td: number | null;
  targets: number | null; receptions: number | null; rec_yds: number | null; rec_td: number | null;
  fg_made: number | null; xp_made: number | null;
  sacks: number | null; def_int: number | null; def_td: number | null;
  fantasy_points: number; fantasy_points_per_game: number | null;
};

export type LineupSeasonStatsPlayer = { playerId: string; espnId?: string; position: string };

/** Fetches season stats for a whole roster's worth of players at once, for a
 * specific year. For the current season, the server reads a database table
 * populated directly from weekly finalization's own already-computed stat lines
 * (robust against Tank01's season-total endpoint lagging behind a game's actual
 * completion); for a past season, it reads ESPN's gamelog -- stable for a season
 * that's been over for a year or more. Either way, the response uses the same
 * field shape, so the caller doesn't need to know which source answered. */
export function useCvcLineupSeasonStats(players: LineupSeasonStatsPlayer[], year: number) {
  const { data } = trpc.league.lineupSeasonStats.useQuery(
    { year, players },
    { enabled: players.length > 0, staleTime: 5 * 60_000 },
  );
  return (data?.statsByPlayerId ?? {}) as Record<string, CvcLineupSeasonStats>;
}
