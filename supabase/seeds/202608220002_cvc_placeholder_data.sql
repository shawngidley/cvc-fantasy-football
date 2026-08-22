do $$
declare
  v_league uuid;
  v_season uuid;
  v_commissioner uuid;
  v_owner_a uuid;
  v_owner_b uuid;
  v_owner_c uuid;
  v_atlas uuid;
  v_harbor uuid;
  v_summit uuid;
  v_metro uuid;
  v_ridge uuid;
  v_north uuid;
  v_week_10 uuid;
  v_week_11 uuid;
  v_qb uuid;
  v_rb uuid;
  v_wr uuid;
  v_te uuid;
  v_draft uuid;
  v_waiver uuid;
begin
  insert into public.league (slug, name, short_name, timezone, primary_color, accent_color, is_public)
  values ('cvc-auction-football', 'CVC Fantasy Football', 'CVC', 'America/New_York', '#17485a', '#e6a43b', true)
  on conflict (slug) do update set name = excluded.name, short_name = excluded.short_name, updated_at = now()
  returning id into v_league;

  insert into public.season (league_id, year, label, status, regular_season_weeks, playoff_teams, starts_at)
  values (v_league, 2026, 'CVC 2026 Foundation Season', 'setup', 14, 6, '2026-09-01T00:00:00Z')
  on conflict (league_id, year) do update set label = excluded.label, status = excluded.status, updated_at = now()
  returning id into v_season;

  insert into public.owner (league_id, display_name, email, role)
  values (v_league, 'Commissioner Placeholder', 'commissioner@example.test', 'commissioner')
  on conflict (league_id, display_name) do update set role = excluded.role, updated_at = now()
  returning id into v_commissioner;
  insert into public.owner (league_id, display_name, email, role)
  values (v_league, 'Owner Alpha Placeholder', 'alpha@example.test', 'owner')
  on conflict (league_id, display_name) do update set role = excluded.role, updated_at = now()
  returning id into v_owner_a;
  insert into public.owner (league_id, display_name, email, role)
  values (v_league, 'Owner Bravo Placeholder', 'bravo@example.test', 'owner')
  on conflict (league_id, display_name) do update set role = excluded.role, updated_at = now()
  returning id into v_owner_b;
  insert into public.owner (league_id, display_name, email, role)
  values (v_league, 'Owner Charlie Placeholder', 'charlie@example.test', 'owner')
  on conflict (league_id, display_name) do update set role = excluded.role, updated_at = now()
  returning id into v_owner_c;

  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_commissioner, 'Atlas Aces', 'ATA', 'Capital', '#30d5c8', 1)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_atlas;
  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_owner_a, 'Harbor Hounds', 'HBH', 'Capital', '#ffb454', 2)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_harbor;
  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_owner_b, 'Summit Wolves', 'SMW', 'Capital', '#8ca3ff', 3)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_summit;
  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_owner_c, 'Metro Monarchs', 'MMO', 'Harbor', '#e68ad0', 4)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_metro;
  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_owner_a, 'Ridge Runners', 'RDR', 'Harbor', '#a4d26f', 5)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_ridge;
  insert into public.franchise (league_id, current_owner_id, name, abbreviation, division_name, brand_color, display_order)
  values (v_league, v_owner_b, 'Northside Knights', 'NSK', 'Harbor', '#ff8f8f', 6)
  on conflict (league_id, abbreviation) do update set name = excluded.name, current_owner_id = excluded.current_owner_id, updated_at = now()
  returning id into v_north;

  insert into public.roster_slot (season_id, code, label, eligible_positions, slot_group, minimum_count, maximum_count, display_order)
  values
    (v_season, 'QB', 'Quarterback', array['QB'], 'starter', 1, 1, 1),
    (v_season, 'RB', 'Running Back', array['RB'], 'starter', 2, 2, 2),
    (v_season, 'WR', 'Wide Receiver', array['WR'], 'starter', 2, 2, 3),
    (v_season, 'TE', 'Tight End', array['TE'], 'starter', 1, 1, 4),
    (v_season, 'FLEX', 'Flex', array['RB','WR','TE'], 'starter', 1, 1, 5),
    (v_season, 'BENCH', 'Bench', array['QB','RB','WR','TE','K','DST'], 'bench', 6, 8, 6)
  on conflict (season_id, code) do update set label = excluded.label;

  insert into public.scoring_rule (season_id, category, stat_key, label, value, applies_to_positions, display_order)
  values
    (v_season, 'Passing', 'passing_yards', 'Passing yard', 0.04, array['QB'], 1),
    (v_season, 'Passing', 'passing_touchdown', 'Passing touchdown', 4, array['QB'], 2),
    (v_season, 'Rushing', 'rushing_yards', 'Rushing yard', 0.10, array['QB','RB','WR'], 3),
    (v_season, 'Receiving', 'reception', 'Reception', 1, array['RB','WR','TE'], 4),
    (v_season, 'Receiving', 'receiving_yards', 'Receiving yard', 0.10, array['RB','WR','TE'], 5),
    (v_season, 'Receiving', 'receiving_touchdown', 'Receiving touchdown', 6, array['RB','WR','TE'], 6)
  on conflict (season_id, stat_key, label) do update set value = excluded.value, is_active = true;

  insert into public.schedule_week (season_id, week_number, label, status, opens_at, locks_at)
  values (v_season, 10, 'Week 10', 'final', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z')
  on conflict (season_id, week_number) do update set status = excluded.status
  returning id into v_week_10;
  insert into public.schedule_week (season_id, week_number, label, status, opens_at, locks_at)
  values (v_season, 11, 'Week 11', 'live', '2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z')
  on conflict (season_id, week_number) do update set status = excluded.status
  returning id into v_week_11;

  insert into public.matchup (schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, result_state, home_projection, away_projection)
  values (v_week_10, v_atlas, v_harbor, 132.4, 128.9, 'final', 130.0, 126.0)
  on conflict (schedule_week_id, home_franchise_id) do update set home_score = excluded.home_score, away_score = excluded.away_score, result_state = excluded.result_state;
  insert into public.matchup (schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, result_state, home_projection, away_projection)
  values (v_week_10, v_summit, v_metro, 96.8, 103.6, 'final', 100.5, 99.2)
  on conflict (schedule_week_id, home_franchise_id) do update set home_score = excluded.home_score, away_score = excluded.away_score, result_state = excluded.result_state;
  insert into public.matchup (schedule_week_id, home_franchise_id, away_franchise_id, home_score, away_score, result_state, home_projection, away_projection)
  values (v_week_11, v_ridge, v_north, 74.2, 69.1, 'live', 111.3, 107.9)
  on conflict (schedule_week_id, home_franchise_id) do update set home_score = excluded.home_score, away_score = excluded.away_score, result_state = excluded.result_state;

  insert into public.player (provider, external_id, display_name, position, nfl_team, status)
  values ('placeholder', 'qb-001', 'Quarterback Placeholder', 'QB', 'NFL', 'active')
  on conflict (provider, external_id) do update set display_name = excluded.display_name
  returning id into v_qb;
  insert into public.player (provider, external_id, display_name, position, nfl_team, status)
  values ('placeholder', 'rb-001', 'Running Back Placeholder', 'RB', 'NFL', 'active')
  on conflict (provider, external_id) do update set display_name = excluded.display_name
  returning id into v_rb;
  insert into public.player (provider, external_id, display_name, position, nfl_team, status)
  values ('placeholder', 'wr-001', 'Wide Receiver Placeholder', 'WR', 'NFL', 'active')
  on conflict (provider, external_id) do update set display_name = excluded.display_name
  returning id into v_wr;
  insert into public.player (provider, external_id, display_name, position, nfl_team, status)
  values ('placeholder', 'te-001', 'Tight End Placeholder', 'TE', 'NFL', 'active')
  on conflict (provider, external_id) do update set display_name = excluded.display_name
  returning id into v_te;

  insert into public.roster_assignment (season_id, franchise_id, player_id, roster_state, assigned_slot_code)
  select v_season, v_atlas, v_qb, 'active', 'QB' where not exists (select 1 from public.roster_assignment where season_id = v_season and franchise_id = v_atlas and player_id = v_qb and released_at is null);
  insert into public.roster_assignment (season_id, franchise_id, player_id, roster_state, assigned_slot_code)
  select v_season, v_atlas, v_rb, 'active', 'RB' where not exists (select 1 from public.roster_assignment where season_id = v_season and franchise_id = v_atlas and player_id = v_rb and released_at is null);
  insert into public.roster_assignment (season_id, franchise_id, player_id, roster_state, assigned_slot_code)
  select v_season, v_atlas, v_wr, 'active', 'WR' where not exists (select 1 from public.roster_assignment where season_id = v_season and franchise_id = v_atlas and player_id = v_wr and released_at is null);
  insert into public.roster_assignment (season_id, franchise_id, player_id, roster_state, assigned_slot_code)
  select v_season, v_atlas, v_te, 'active', 'TE' where not exists (select 1 from public.roster_assignment where season_id = v_season and franchise_id = v_atlas and player_id = v_te and released_at is null);

  insert into public."transaction" (season_id, franchise_id, actor_owner_id, transaction_type, status, summary, details)
  select v_season, v_atlas, v_commissioner, 'waiver', 'final', 'Atlas Aces added Quarterback Placeholder', '{"source":"placeholder seed","faab":12}'::jsonb
  where not exists (select 1 from public."transaction" where season_id = v_season and summary = 'Atlas Aces added Quarterback Placeholder');
  insert into public."transaction" (season_id, franchise_id, actor_owner_id, transaction_type, status, summary, details)
  select v_season, v_harbor, v_owner_a, 'trade', 'final', 'Harbor Hounds and Summit Wolves completed a placeholder trade', '{"source":"placeholder seed"}'::jsonb
  where not exists (select 1 from public."transaction" where season_id = v_season and summary = 'Harbor Hounds and Summit Wolves completed a placeholder trade');

  insert into public.draft (season_id, label, draft_type, status, pick_timer_seconds, keeper_enabled, lottery_enabled, settings)
  values (v_season, '2026 CVC Foundation Draft', 'auction', 'setup', 90, true, true, '{"budget":200,"rounds":16}'::jsonb)
  on conflict (season_id) do update set label = excluded.label, draft_type = excluded.draft_type, settings = excluded.settings, updated_at = now()
  returning id into v_draft;
  insert into public.draft_pick (draft_id, round_number, pick_number, original_franchise_id, current_franchise_id, pick_status, is_protected, notes)
  values
    (v_draft, 1, 1, v_north, v_north, 'open', false, 'Lottery order placeholder'),
    (v_draft, 1, 2, v_ridge, v_ridge, 'open', false, 'Original pick placeholder'),
    (v_draft, 1, 3, v_metro, v_metro, 'open', true, 'Protection placeholder'),
    (v_draft, 1, 4, v_summit, v_summit, 'open', false, 'Original pick placeholder')
  on conflict (draft_id, pick_number) do update set notes = excluded.notes, is_protected = excluded.is_protected;

  insert into public.waiver_period (season_id, label, opens_at, closes_at, status)
  values (v_season, 'Week 11 FAAB Run', '2026-11-10T12:00:00Z', '2026-11-11T12:00:00Z', 'scheduled')
  returning id into v_waiver;
  insert into public.faab_bid (waiver_period_id, franchise_id, player_id, amount, priority, status)
  values (v_waiver, v_atlas, v_qb, 12, 1, 'pending')
  on conflict (waiver_period_id, franchise_id, player_id) do update set amount = excluded.amount, priority = excluded.priority, status = excluded.status;

  insert into public.rule_document (league_id, season_id, title, slug, content_markdown, version_label, is_published, published_at, created_by_owner_id)
  values (v_league, v_season, 'CVC Foundation Rules', 'foundation-rules', '# CVC Foundation Rules\n\nPlaceholder commissioner-managed rules content.', 'Draft 0.1', false, null, v_commissioner)
  on conflict (league_id, slug, version_label) do update set content_markdown = excluded.content_markdown, updated_at = now();

  insert into public.league_financial_entry (season_id, franchise_id, entry_type, amount, status, due_at, memo)
  values
    (v_season, v_atlas, 'dues', 100.00, 'open', '2026-09-01T00:00:00Z', 'Placeholder league dues'),
    (v_season, v_harbor, 'payout', 0.00, 'open', null, 'Placeholder future payout')
  on conflict do nothing;

  insert into public.audit_event (league_id, season_id, actor_owner_id, entity_type, entity_id, action, summary, payload)
  select v_league, v_season, v_commissioner, 'league', v_league, 'seeded', 'CVC placeholder league data initialized', '{"source":"foundation seed"}'::jsonb
  where not exists (select 1 from public.audit_event where league_id = v_league and action = 'seeded' and summary = 'CVC placeholder league data initialized');
end $$;
