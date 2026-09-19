-- Relabel the QB passing-yardage bonus from 350 to 300 (commissioner call, Sept 2026).
--
-- The engine threshold already moved in shared/cvcScoring.ts (a171f64), but the rules
-- page renders scoring_rule.label verbatim (client/src/components/CvcRules.tsx ->
-- league.scoringRules), so without this the site pays the bonus at 300 while still
-- telling owners it takes 350.
--
-- The row's stat_key deliberately stays "passing_350_bonus": it is an internal
-- identifier that shared/cvcScoring.ts looks the value up by, and renaming it would
-- silently zero the bonus.
--
-- Scoped to the current season only (the same is_current flag getCurrentLeagueAndSeason
-- uses), so prior-season rows keep saying 350 -- in those seasons the rule really was
-- 350, and the historical-stats crons rescore them off their own season's rules.
--
-- Uses replace() rather than a hardcoded string so whatever wording the row already has
-- ("350+ passing yards", "350 Passing Yard Bonus", ...) survives with only the number
-- changed. The label filter makes it a no-op on re-run.

update public.scoring_rule as sr
set label = replace(sr.label, '350', '300')
from public.season as s
where sr.season_id = s.id
  and s.is_current
  and sr.stat_key = 'passing_350_bonus'
  and sr.label like '%350%';
