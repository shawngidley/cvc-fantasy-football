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
