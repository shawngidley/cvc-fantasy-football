-- Future-week lineup planning. Separate from roster_assignment on purpose --
-- roster_assignment also tracks acquisition history/roster state that isn't
-- week-specific, and only ever holds ONE current slot per player (no per-week
-- concept at all). This table lets an owner plan a different slot for a specific
-- future week; a week with no row here for a given player falls back to the most
-- recent earlier explicit setting (an earlier planned week, or if none, the
-- player's actual current roster_assignment slot) -- see the "effective lineup"
-- resolution logic in tank01ScoringSync.ts and league.ts.
create table if not exists public.planned_lineup_assignment (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  schedule_week_id uuid not null references public.schedule_week(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete cascade,
  slot_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_week_id, franchise_id, player_id)
);

create index if not exists planned_lineup_assignment_week_franchise_idx
  on public.planned_lineup_assignment (schedule_week_id, franchise_id);

alter table public.planned_lineup_assignment enable row level security;
revoke all on table public.planned_lineup_assignment from anon, authenticated;
grant select, insert, update, delete on table public.planned_lineup_assignment to service_role;
