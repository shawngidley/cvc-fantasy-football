-- Commissioner call, Sept 2026: score 2-point conversions at 2 points each, for
-- passing, rushing, and receiving alike.
--
-- The engine already reads these three stat_keys (shared/cvcScoring.ts's
-- calculateCvcFantasyPointsBreakdown), gated the same way every other
-- passing/rushing/receiving rule already is -- open to QB/RB/WR/TE so a trick-play
-- score (e.g. a WR throwing or a RB catching a conversion) counts the same as the
-- position it'd normally come from. Without a matching scoring_rule row, ruleValue()
-- returns 0 for an unmatched stat_key and the code silently scores nothing -- this
-- migration is what actually turns the new engine support on.
--
-- Scoped to the current season only (the same is_current flag getCurrentLeagueAndSeason
-- uses), matching 202609190001's precedent -- a prior season's rules reflect what was
-- really in effect that season.
--
-- Safe to re-run: the table's own (season_id, stat_key, label) uniqueness makes the
-- insert a no-op the second time.
insert into public.scoring_rule (season_id, category, stat_key, label, value, applies_to_positions, display_order)
select s.id, category, stat_key, label, 2, array['QB', 'RB', 'WR', 'TE'], display_order
from public.season as s
cross join (values
  ('Passing', 'passing_two_point_conversion', 'Passing 2pt conversion', 15),
  ('Rushing', 'rushing_two_point_conversion', 'Rushing 2pt conversion', 25),
  ('Receiving', 'receiving_two_point_conversion', 'Receiving 2pt conversion', 35)
) as new_rules(category, stat_key, label, display_order)
where s.is_current
on conflict (season_id, stat_key, label) do nothing;
