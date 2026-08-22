create table if not exists public.tank01_scoring_sync_state (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references public.season(id) on delete cascade,
  schedule_cron_task_uid varchar(65),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_lineup_snapshot (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  schedule_week_id uuid not null references public.schedule_week(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete restrict,
  roster_assignment_id uuid references public.roster_assignment(id) on delete set null,
  slot_code text not null,
  created_at timestamptz not null default now(),
  unique (schedule_week_id, franchise_id, player_id)
);

create index if not exists weekly_lineup_snapshot_week_franchise_idx on public.weekly_lineup_snapshot (schedule_week_id, franchise_id);
create index if not exists tank01_scoring_sync_state_cron_idx on public.tank01_scoring_sync_state (schedule_cron_task_uid);

alter table public.tank01_scoring_sync_state enable row level security;
alter table public.weekly_lineup_snapshot enable row level security;
revoke all on table public.tank01_scoring_sync_state, public.weekly_lineup_snapshot from anon, authenticated;
grant select, insert, update, delete on table public.tank01_scoring_sync_state, public.weekly_lineup_snapshot to service_role;
