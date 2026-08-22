create extension if not exists pgcrypto;

create table if not exists public.league (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text not null,
  timezone text not null default 'America/New_York',
  logo_url text,
  primary_color text not null default '#17485a',
  accent_color text not null default '#e6a43b',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.season (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  year integer not null,
  label text not null,
  status text not null default 'setup' check (status in ('setup', 'preseason', 'regular', 'playoffs', 'complete', 'archived')),
  regular_season_weeks integer,
  playoff_teams integer,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, year)
);

create table if not exists public.owner (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  user_open_id text unique,
  display_name text not null,
  email text,
  role text not null default 'owner' check (role in ('owner', 'commissioner', 'administrator')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, display_name)
);

create table if not exists public.franchise (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  current_owner_id uuid references public.owner(id) on delete set null,
  name text not null,
  abbreviation text not null,
  division_name text,
  logo_url text,
  brand_color text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, abbreviation)
);

create table if not exists public.roster_slot (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  code text not null,
  label text not null,
  eligible_positions text[] not null default '{}',
  slot_group text not null default 'starter' check (slot_group in ('starter', 'bench', 'reserve', 'injured_reserve', 'taxi')),
  minimum_count integer not null default 0 check (minimum_count >= 0),
  maximum_count integer not null default 1 check (maximum_count >= 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (season_id, code)
);

create table if not exists public.scoring_rule (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  category text not null,
  stat_key text not null,
  label text not null,
  value numeric(10, 3) not null,
  applies_to_positions text[] not null default '{}',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (season_id, stat_key, label)
);

create table if not exists public.schedule_week (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  week_number integer not null check (week_number > 0),
  label text not null,
  opens_at timestamptz,
  locks_at timestamptz,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'final', 'archived')),
  created_at timestamptz not null default now(),
  unique (season_id, week_number)
);

create table if not exists public.matchup (
  id uuid primary key default gen_random_uuid(),
  schedule_week_id uuid not null references public.schedule_week(id) on delete cascade,
  home_franchise_id uuid not null references public.franchise(id) on delete restrict,
  away_franchise_id uuid not null references public.franchise(id) on delete restrict,
  home_score numeric(10, 2) not null default 0,
  away_score numeric(10, 2) not null default 0,
  result_state text not null default 'upcoming' check (result_state in ('upcoming', 'live', 'final', 'corrected')),
  home_projection numeric(10, 2),
  away_projection numeric(10, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_franchise_id <> away_franchise_id),
  unique (schedule_week_id, home_franchise_id),
  unique (schedule_week_id, away_franchise_id)
);

create table if not exists public.player (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'placeholder',
  external_id text,
  display_name text not null,
  position text,
  nfl_team text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

create table if not exists public.roster_assignment (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete restrict,
  roster_state text not null default 'active' check (roster_state in ('active', 'bench', 'injured_reserve', 'taxi', 'waivers', 'free_agent', 'released')),
  assigned_slot_code text,
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, franchise_id, player_id, acquired_at)
);

create table if not exists public."transaction" (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  franchise_id uuid references public.franchise(id) on delete set null,
  actor_owner_id uuid references public.owner(id) on delete set null,
  transaction_type text not null check (transaction_type in ('add', 'drop', 'trade', 'waiver', 'commissioner_adjustment', 'lineup_move', 'draft_pick', 'note')),
  status text not null default 'final' check (status in ('pending', 'approved', 'rejected', 'final', 'reversed')),
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.draft (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references public.season(id) on delete cascade,
  label text not null,
  draft_type text not null default 'snake' check (draft_type in ('snake', 'linear', 'auction', 'rookie', 'supplemental')),
  status text not null default 'setup' check (status in ('setup', 'lottery', 'live', 'paused', 'complete')),
  pick_timer_seconds integer,
  keeper_enabled boolean not null default false,
  lottery_enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_pick (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.draft(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  pick_number integer not null check (pick_number > 0),
  original_franchise_id uuid not null references public.franchise(id) on delete restrict,
  current_franchise_id uuid not null references public.franchise(id) on delete restrict,
  player_id uuid references public.player(id) on delete set null,
  pick_status text not null default 'open' check (pick_status in ('open', 'selected', 'forfeited', 'void')),
  is_protected boolean not null default false,
  selected_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (draft_id, pick_number)
);

create table if not exists public.waiver_period (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  label text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'processing', 'final', 'cancelled')),
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table if not exists public.faab_bid (
  id uuid primary key default gen_random_uuid(),
  waiver_period_id uuid not null references public.waiver_period(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete restrict,
  drop_player_id uuid references public.player(id) on delete set null,
  amount integer not null check (amount >= 0),
  priority integer not null default 1 check (priority > 0),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'cancelled')),
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (waiver_period_id, franchise_id, player_id)
);

create table if not exists public.rule_document (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  season_id uuid references public.season(id) on delete set null,
  title text not null,
  slug text not null,
  content_markdown text not null,
  version_label text not null default 'Draft',
  is_published boolean not null default false,
  published_at timestamptz,
  created_by_owner_id uuid references public.owner(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, slug, version_label)
);

create table if not exists public.league_financial_entry (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  franchise_id uuid references public.franchise(id) on delete set null,
  entry_type text not null check (entry_type in ('dues', 'payout', 'penalty', 'credit', 'adjustment')),
  amount numeric(10, 2) not null,
  status text not null default 'open' check (status in ('open', 'paid', 'waived', 'void')),
  due_at timestamptz,
  paid_at timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_event (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.league(id) on delete cascade,
  season_id uuid references public.season(id) on delete set null,
  actor_owner_id uuid references public.owner(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists season_league_status_idx on public.season (league_id, status);
create index if not exists franchise_league_division_idx on public.franchise (league_id, division_name);
create index if not exists owner_league_role_idx on public.owner (league_id, role);
create index if not exists matchup_week_state_idx on public.matchup (schedule_week_id, result_state);
create index if not exists player_lookup_idx on public.player (display_name, position, nfl_team);
create index if not exists roster_assignment_lookup_idx on public.roster_assignment (season_id, franchise_id, roster_state);
create index if not exists transaction_ledger_idx on public."transaction" (season_id, occurred_at desc);
create index if not exists draft_pick_board_idx on public.draft_pick (draft_id, pick_number);
create index if not exists faab_bid_waiver_idx on public.faab_bid (waiver_period_id, status, amount desc);
create index if not exists audit_event_league_idx on public.audit_event (league_id, created_at desc);

alter table public.league enable row level security;
alter table public.season enable row level security;
alter table public.owner enable row level security;
alter table public.franchise enable row level security;
alter table public.roster_slot enable row level security;
alter table public.scoring_rule enable row level security;
alter table public.schedule_week enable row level security;
alter table public.matchup enable row level security;
alter table public.player enable row level security;
alter table public.roster_assignment enable row level security;
alter table public."transaction" enable row level security;
alter table public.draft enable row level security;
alter table public.draft_pick enable row level security;
alter table public.waiver_period enable row level security;
alter table public.faab_bid enable row level security;
alter table public.rule_document enable row level security;
alter table public.league_financial_entry enable row level security;
alter table public.audit_event enable row level security;

revoke all on table public.league, public.season, public.owner, public.franchise, public.roster_slot, public.scoring_rule, public.schedule_week, public.matchup, public.player, public.roster_assignment, public."transaction", public.draft, public.draft_pick, public.waiver_period, public.faab_bid, public.rule_document, public.league_financial_entry, public.audit_event from anon, authenticated;
grant select, insert, update, delete on table public.league, public.season, public.owner, public.franchise, public.roster_slot, public.scoring_rule, public.schedule_week, public.matchup, public.player, public.roster_assignment, public."transaction", public.draft, public.draft_pick, public.waiver_period, public.faab_bid, public.rule_document, public.league_financial_entry, public.audit_event to service_role;
