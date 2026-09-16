export type CvcStandingsMatchup = {
  week?: { week_number?: number | null } | null;
  home_franchise_id?: string | null;
  away_franchise_id?: string | null;
  result_state?: string | null;
};

/** Selects which matchup the Standings page's "your matchup" widget shows. Previously
 * hardcoded to week_number === 1 -- correct only for the season's actual first week,
 * and never updated after that, so this widget stayed permanently stuck on Week 1's
 * (by-then-final) matchup for the rest of the season regardless of what week it
 * actually was. currentWeekNumber comes from the server's own planning-week
 * resolution (see resolveEffectivePlanningWeek in league.ts) -- the same "current
 * week" every other planning-oriented page now uses. Falls back to the old
 * find-a-non-final-matchup behavior only if no current week number is available at
 * all (e.g. before the season's schedule_week rows exist). */
export function selectCvcStandingsMatchup<T extends CvcStandingsMatchup>(matchups: T[], franchiseId?: string | null, currentWeekNumber?: number | null) {
  const currentWeekMatchups = currentWeekNumber != null ? matchups.filter(matchup => Number(matchup.week?.week_number) === currentWeekNumber) : [];
  const personalCurrentWeek = franchiseId
    ? currentWeekMatchups.find(matchup => matchup.home_franchise_id === franchiseId || matchup.away_franchise_id === franchiseId)
    : undefined;
  return {
    matchup: personalCurrentWeek ?? currentWeekMatchups[0] ?? matchups.find(matchup => matchup.result_state !== "final"),
    isPersonal: Boolean(personalCurrentWeek),
  };
}
