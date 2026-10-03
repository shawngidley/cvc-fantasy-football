-- First batch of commissioner-supplied CVC historical seasons: 2016-2019.
-- Transcribed verbatim from the commissioner's own standings/payout spreadsheet export
-- for each year (East/West division standings with division-only W-L, GB, PF/PA, and
-- division-title/playoff-berth clinch flags, plus the playoff bracket through the Super
-- Bowl). Owner names are kept exactly as given in that spreadsheet (e.g. "David Su." vs
-- "David S.", "Jason S." vs "Jason H.") since that's how these two decades of data
-- distinguish same-first-name owners; nothing here is inferred or filled in.

do $$
declare
  v_league uuid;
  v_2016 uuid;
  v_2017 uuid;
  v_2018 uuid;
  v_2019 uuid;
begin
  select id into v_league from public.league where slug = 'cvc-auction-football';
  if v_league is null then
    raise exception 'CVC league row not found; run the league-domain seed before this migration.';
  end if;

  -- 2016 -- champion: Shawn (Vipers) over David Su. (Shepard's Pie), 150.60-136.95
  insert into public.cvc_season_history (league_id, year, champion_owner_name, champion_team_name, champion_score, runner_up_owner_name, runner_up_team_name, runner_up_score)
  values (v_league, 2016, 'Shawn', 'Vipers', 150.60, 'David Su.', 'Shepard''s Pie', 136.95)
  on conflict (league_id, year) do update set champion_owner_name = excluded.champion_owner_name, champion_team_name = excluded.champion_team_name, champion_score = excluded.champion_score, runner_up_owner_name = excluded.runner_up_owner_name, runner_up_team_name = excluded.runner_up_team_name, runner_up_score = excluded.runner_up_score
  returning id into v_2016;
  delete from public.cvc_season_history_standing where season_history_id = v_2016;
  delete from public.cvc_season_history_playoff_game where season_history_id = v_2016;
  insert into public.cvc_season_history_standing (season_history_id, division_name, owner_name, team_name, wins, losses, games_back, points_for, points_against, division_wins, division_losses, clinched, standing_order)
  values
    (v_2016, 'East', 'Shawn', 'Vipers', 9, 4, '-', 1575.55, 1471.35, 6, 2, 'division', 1),
    (v_2016, 'East', 'Rich', 'Dirty Scrapers', 7, 6, '2', 1477.65, 1289.65, 4, 4, 'playoff', 2),
    (v_2016, 'East', 'Brian', 'Dresser Drawer Devices', 6, 7, '3', 1384.80, 1573.10, 5, 3, 'playoff', 3),
    (v_2016, 'East', 'Jason S.', 'Washington Foreskins', 6, 7, '3', 1418.75, 1464.30, 3, 5, null, 4),
    (v_2016, 'East', 'Jonas', 'The Super Snuffleupagus', 3, 10, '6', 1375.00, 1477.30, 2, 6, null, 5),
    (v_2016, 'West', 'David Su.', 'Shepard''s Pie', 9, 4, '-', 1465.30, 1506.20, 6, 2, 'division', 1),
    (v_2016, 'West', 'David S.', 'The Legends', 8, 5, '1', 1602.96, 1394.60, 5, 3, 'playoff', 2),
    (v_2016, 'West', 'Scott', 'Miller Time', 7, 6, '2', 1557.05, 1370.50, 5, 3, 'playoff', 3),
    (v_2016, 'West', 'Justin', 'DS Warteaters', 5, 8, '4', 1352.70, 1571.90, 3, 5, null, 4),
    (v_2016, 'West', 'Jason H.', 'Buster Hymens', 5, 8, '4', 1379.70, 1470.56, 1, 7, null, 5);
  insert into public.cvc_season_history_playoff_game (season_history_id, round_label, owner_a_name, score_a, owner_b_name, score_b, winner_owner_name, game_order)
  values
    (v_2016, 'Wild Card Round', 'Brian', 86.60, 'David S.', 105.50, 'David S.', 1),
    (v_2016, 'Wild Card Round', 'Scott', 115.30, 'Rich', 115.20, 'Scott', 2),
    (v_2016, 'Divisional Round', 'Scott', 102.10, 'David Su.', 112.70, 'David Su.', 3),
    (v_2016, 'Divisional Round', 'David S.', 106.45, 'Shawn', 124.00, 'Shawn', 4),
    (v_2016, 'Super Bowl', 'Shawn', 150.60, 'David Su.', 136.95, 'Shawn', 5);

  -- 2017 -- champion: Shawn (Vipers) over Justin (DS Warteaters), 137.55-80.20
  insert into public.cvc_season_history (league_id, year, champion_owner_name, champion_team_name, champion_score, runner_up_owner_name, runner_up_team_name, runner_up_score)
  values (v_league, 2017, 'Shawn', 'Vipers', 137.55, 'Justin', 'DS Warteaters', 80.20)
  on conflict (league_id, year) do update set champion_owner_name = excluded.champion_owner_name, champion_team_name = excluded.champion_team_name, champion_score = excluded.champion_score, runner_up_owner_name = excluded.runner_up_owner_name, runner_up_team_name = excluded.runner_up_team_name, runner_up_score = excluded.runner_up_score
  returning id into v_2017;
  delete from public.cvc_season_history_standing where season_history_id = v_2017;
  delete from public.cvc_season_history_playoff_game where season_history_id = v_2017;
  insert into public.cvc_season_history_standing (season_history_id, division_name, owner_name, team_name, wins, losses, games_back, points_for, points_against, division_wins, division_losses, clinched, standing_order)
  values
    (v_2017, 'East', 'Brian', 'Dresser Drawer Devices', 9, 4, '-', 1541.70, 1425.50, 4, 4, 'division', 1),
    (v_2017, 'East', 'Rich', 'Dirty Scrapers', 7, 6, '2', 1431.85, 1409.50, 5, 3, 'playoff', 2),
    (v_2017, 'East', 'Shawn', 'Vipers', 7, 6, '2', 1554.05, 1362.40, 5, 3, 'playoff', 3),
    (v_2017, 'East', 'Jason S.', 'Washington Foreskins', 7, 6, '2', 1486.35, 1464.30, 3, 5, null, 4),
    (v_2017, 'East', 'Jonas', 'The Super Snuffleupagus', 5, 8, '4', 1367.95, 1384.10, 3, 5, null, 5),
    (v_2017, 'West', 'Justin', 'DS Warteaters', 8, 5, '-', 1282.20, 1310.30, 5, 3, 'division', 1),
    (v_2017, 'West', 'David Su.', 'Shepard''s Pie', 7, 6, '1', 1318.55, 1288.20, 5, 3, 'playoff', 2),
    (v_2017, 'West', 'Jason H.', 'Buster Hymens', 7, 6, '1', 1315.80, 1355.40, 5, 3, 'playoff', 3),
    (v_2017, 'West', 'David S.', 'The Legends', 5, 8, '3', 1282.15, 1520.45, 4, 4, null, 4),
    (v_2017, 'West', 'Scott', 'Miller Time', 3, 10, '5', 1308.45, 1368.90, 1, 7, null, 5);
  insert into public.cvc_season_history_playoff_game (season_history_id, round_label, owner_a_name, score_a, owner_b_name, score_b, winner_owner_name, game_order)
  values
    (v_2017, 'Wild Card Round', 'Shawn', 122.85, 'Rich', 103.85, 'Shawn', 1),
    (v_2017, 'Wild Card Round', 'Jason H.', 105.35, 'David Su.', 76.30, 'Jason H.', 2),
    (v_2017, 'Divisional Round', 'Shawn', 176.40, 'Brian', 107.10, 'Shawn', 3),
    (v_2017, 'Divisional Round', 'Jason H.', 87.95, 'Justin', 96.90, 'Justin', 4),
    (v_2017, 'Super Bowl', 'Shawn', 137.55, 'Justin', 80.20, 'Shawn', 5);

  -- 2018 -- champion: Shawn (Vipers) over David S. (The Legends), 128.75-108.85
  insert into public.cvc_season_history (league_id, year, champion_owner_name, champion_team_name, champion_score, runner_up_owner_name, runner_up_team_name, runner_up_score)
  values (v_league, 2018, 'Shawn', 'Vipers', 128.75, 'David S.', 'The Legends', 108.85)
  on conflict (league_id, year) do update set champion_owner_name = excluded.champion_owner_name, champion_team_name = excluded.champion_team_name, champion_score = excluded.champion_score, runner_up_owner_name = excluded.runner_up_owner_name, runner_up_team_name = excluded.runner_up_team_name, runner_up_score = excluded.runner_up_score
  returning id into v_2018;
  delete from public.cvc_season_history_standing where season_history_id = v_2018;
  delete from public.cvc_season_history_playoff_game where season_history_id = v_2018;
  insert into public.cvc_season_history_standing (season_history_id, division_name, owner_name, team_name, wins, losses, games_back, points_for, points_against, division_wins, division_losses, clinched, standing_order)
  values
    (v_2018, 'East', 'Shawn', 'Vipers', 10, 3, '-', 1972.85, 1589.25, 7, 1, 'division', 1),
    (v_2018, 'East', 'Jason S.', 'Washington Foreskins', 9, 4, '1', 1830.80, 1623.50, 5, 3, 'playoff', 2),
    (v_2018, 'East', 'Jonas', 'The Super Snuffleupagus', 5, 8, '4', 1754.90, 1736.15, 4, 4, null, 3),
    (v_2018, 'East', 'Jamie', 'The Four Horsemen', 5, 8, '4', 1502.85, 1840.10, 3, 5, null, 4),
    (v_2018, 'East', 'Brian', 'Dresser Drawer Devices', 2, 11, '8', 1447.50, 1718.40, 1, 7, null, 5),
    (v_2018, 'West', 'David S.', 'The Legends', 9, 4, '-', 1815.70, 1700.40, 5, 3, 'division', 1),
    (v_2018, 'West', 'Scott', 'Miller Time', 8, 5, '1', 1672.90, 1568.50, 5, 3, 'playoff', 2),
    (v_2018, 'West', 'Justin', 'DS Warteaters', 6, 7, '3', 1634.20, 1675.80, 4, 4, 'playoff', 3),
    (v_2018, 'West', 'David Su.', 'Shepard''s Pie', 6, 7, '3', 1740.15, 1679.95, 3, 5, 'playoff', 4),
    (v_2018, 'West', 'Jason H.', 'Buster Hymens', 5, 8, '4', 1709.15, 1948.95, 3, 5, null, 5);
  insert into public.cvc_season_history_playoff_game (season_history_id, round_label, owner_a_name, score_a, owner_b_name, score_b, winner_owner_name, game_order)
  values
    (v_2018, 'Wild Card Round', 'Jason S.', 125.50, 'David Su.', 142.10, 'David Su.', 1),
    (v_2018, 'Wild Card Round', 'Scott', 144.15, 'Justin', 120.90, 'Scott', 2),
    (v_2018, 'Divisional Round', 'Shawn', 118.15, 'David Su.', 93.20, 'Shawn', 3),
    (v_2018, 'Divisional Round', 'David S.', 89.50, 'Scott', 84.55, 'David S.', 4),
    (v_2018, 'Super Bowl', 'Shawn', 128.75, 'David S.', 108.85, 'Shawn', 5);

  -- 2019 -- champion: Justin (DS Warteaters) over Jamie (The Four Horsemen), 138.65-117.85
  insert into public.cvc_season_history (league_id, year, champion_owner_name, champion_team_name, champion_score, runner_up_owner_name, runner_up_team_name, runner_up_score)
  values (v_league, 2019, 'Justin', 'DS Warteaters', 138.65, 'Jamie', 'The Four Horsemen', 117.85)
  on conflict (league_id, year) do update set champion_owner_name = excluded.champion_owner_name, champion_team_name = excluded.champion_team_name, champion_score = excluded.champion_score, runner_up_owner_name = excluded.runner_up_owner_name, runner_up_team_name = excluded.runner_up_team_name, runner_up_score = excluded.runner_up_score
  returning id into v_2019;
  delete from public.cvc_season_history_standing where season_history_id = v_2019;
  delete from public.cvc_season_history_playoff_game where season_history_id = v_2019;
  insert into public.cvc_season_history_standing (season_history_id, division_name, owner_name, team_name, wins, losses, games_back, points_for, points_against, division_wins, division_losses, clinched, standing_order)
  values
    (v_2019, 'East', 'Jonas', 'The Super Snuffleupagus', 8, 5, '-', 1646.25, 1733.05, 5, 3, 'division', 1),
    (v_2019, 'East', 'Shawn', 'Vipers', 8, 5, '-', 1715.65, 1518.65, 4, 4, 'playoff', 2),
    (v_2019, 'East', 'Jamie', 'The Four Horsemen', 7, 6, '1', 1645.10, 1534.30, 4, 4, 'playoff', 3),
    (v_2019, 'East', 'Brian', 'Dresser Drawer Devices', 7, 6, '1', 1544.50, 1630.25, 4, 4, 'playoff', 4),
    (v_2019, 'East', 'Jason S.', 'Washington Foreskins', 5, 8, '3', 1602.20, 1649.15, 3, 5, null, 5),
    (v_2019, 'West', 'Justin', 'DS Warteaters', 9, 4, '-', 1935.80, 1631.70, 6, 2, 'division', 1),
    (v_2019, 'West', 'Jason H.', 'Buster Hymens', 7, 6, '2', 1561.45, 1541.10, 4, 4, 'playoff', 2),
    (v_2019, 'West', 'David Su.', 'Shepard''s Pie', 7, 6, '2', 1544.95, 1564.80, 4, 4, null, 3),
    (v_2019, 'West', 'David S.', 'The Legends', 4, 9, '5', 1448.75, 1732.30, 4, 4, null, 4),
    (v_2019, 'West', 'Scott', 'Miller Time', 3, 10, '6', 1618.00, 1727.35, 2, 6, null, 5);
  insert into public.cvc_season_history_playoff_game (season_history_id, round_label, owner_a_name, score_a, owner_b_name, score_b, winner_owner_name, game_order)
  values
    (v_2019, 'Wild Card Round', 'Shawn', 123.70, 'Brian', 130.90, 'Brian', 1),
    (v_2019, 'Wild Card Round', 'Jason H.', 81.05, 'Jamie', 116.65, 'Jamie', 2),
    (v_2019, 'Divisional Round', 'Brian', 120.65, 'Justin', 125.70, 'Justin', 3),
    (v_2019, 'Divisional Round', 'Jamie', 136.70, 'Jonas', 130.45, 'Jamie', 4),
    (v_2019, 'Super Bowl', 'Jamie', 117.85, 'Justin', 138.65, 'Justin', 5);
end $$;
