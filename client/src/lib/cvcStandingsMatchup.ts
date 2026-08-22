export type CvcStandingsMatchup = {
  week?: { week_number?: number | null } | null;
  home_franchise_id?: string | null;
  away_franchise_id?: string | null;
  result_state?: string | null;
};

export function selectCvcStandingsMatchup<T extends CvcStandingsMatchup>(matchups: T[], franchiseId?: string | null) {
  const weekOne = matchups.filter(matchup => Number(matchup.week?.week_number) === 1);
  const personalWeekOne = franchiseId
    ? weekOne.find(matchup => matchup.home_franchise_id === franchiseId || matchup.away_franchise_id === franchiseId)
    : undefined;
  return {
    matchup: personalWeekOne ?? weekOne[0] ?? matchups.find(matchup => matchup.result_state !== "final"),
    isPersonal: Boolean(personalWeekOne),
  };
}
