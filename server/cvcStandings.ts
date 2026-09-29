export type CvcFinalMatchup = { home_franchise_id: string; away_franchise_id: string; home_score: number | string; away_score: number | string };

/** Pairwise head-to-head result between two specific franchises this season, based
 * only on their own direct matchups against each other: positive if `leftId` won more
 * of those games, negative if `rightId` did, 0 if equal (including if they never
 * played each other, or split evenly). Confirmed as the required first standings
 * tiebreaker in CVC's actual documented rules (docs/CVC_2026_Rules_and_Protection_
 * Findings.md: "divisional ties use head-to-head, division record, and points
 * scored") -- the standings sort previously jumped straight from wins/losses to
 * points scored, skipping head-to-head (and division record, tracked but unused)
 * entirely. */
export function headToHeadDelta(leftId: string, rightId: string, finalMatchups: CvcFinalMatchup[]): number {
  let leftWins = 0;
  let rightWins = 0;
  for (const matchup of finalMatchups) {
    const isBetweenThem = (matchup.home_franchise_id === leftId && matchup.away_franchise_id === rightId) || (matchup.home_franchise_id === rightId && matchup.away_franchise_id === leftId);
    if (!isBetweenThem) continue;
    const homeScore = Number(matchup.home_score);
    const awayScore = Number(matchup.away_score);
    if (homeScore === awayScore) continue; // a tied matchup breaks nothing either way
    const winnerId = homeScore > awayScore ? matchup.home_franchise_id : matchup.away_franchise_id;
    if (winnerId === leftId) leftWins += 1;
    else if (winnerId === rightId) rightWins += 1;
  }
  return leftWins - rightWins;
}

/** A final matchup plus the week it was played in, so streaks can be counted in
 * chronological order. The raw matchup rows only carry `schedule_week_id`, so the
 * caller resolves the week number before handing rows here. */
export type CvcFinalMatchupWithWeek = CvcFinalMatchup & { week_number: number };

/** The current win/loss streak for one franchise, formatted for the Standings page's
 * Streak column: "W3", "L2", "T1", or "—" when the franchise has no completed games
 * yet. Counts backwards from the most recently played final matchup and stops at the
 * first result of a different kind.
 *
 * The bug this fixes: the Standings page shipped a Streak column header with a
 * hard-coded "—" in every row -- nothing anywhere in the codebase ever computed a
 * streak.
 *
 * A tie is reported as "T1" and never accumulates, not even with another tie: CVC has
 * no tiebreak shootout, so a tie is a real possible outcome, but "tied twice in a row"
 * isn't a streak anyone tracks. */
export function calculateStreak(franchiseId: string, finalMatchups: CvcFinalMatchupWithWeek[]): string {
  const games = finalMatchups
    .filter(matchup => matchup.home_franchise_id === franchiseId || matchup.away_franchise_id === franchiseId)
    .sort((left, right) => right.week_number - left.week_number); // most recent first
  if (!games.length) return "—";

  const outcomeOf = (matchup: CvcFinalMatchupWithWeek): "W" | "L" | "T" => {
    const isHome = matchup.home_franchise_id === franchiseId;
    const own = Number(isHome ? matchup.home_score : matchup.away_score);
    const opponent = Number(isHome ? matchup.away_score : matchup.home_score);
    if (own === opponent) return "T";
    return own > opponent ? "W" : "L";
  };

  const streakKind = outcomeOf(games[0]);
  if (streakKind === "T") return "T1";
  let length = 0;
  for (const game of games) {
    if (outcomeOf(game) !== streakKind) break;
    length += 1;
  }
  return `${streakKind}${length}`;
}
