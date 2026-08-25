-- Round 2 rookie draft order lottery. The full drawn order is generated
-- server-side (node:crypto.randomInt Fisher-Yates shuffle) the instant the
-- lottery starts and is never sent to the client -- only its SHA-256
-- commitment hash is, so the draw is provably locked before anything is
-- revealed. Reveals themselves are computed from elapsed time server-side
-- (see server/rookieDraftLottery.ts), not client-driven, and persisted one
-- row at a time into rookie_draft_lottery_reveal as they occur.
create table if not exists public.rookie_draft_lottery (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.draft(id) on delete cascade,
  round_number integer not null default 2,
  status text not null default 'READY' check (status in ('READY', 'RUNNING', 'PAUSED', 'COMPLETE', 'ABORTED')),
  franchise_order uuid[] not null,
  franchise_count integer not null,
  order_commitment text not null,
  reveal_interval_seconds integer not null default 20,
  revealed_count integer not null default 0,
  started_at timestamptz,
  elapsed_ms_before_pause bigint not null default 0,
  paused_at timestamptz,
  completed_at timestamptz,
  aborted_at timestamptz,
  abort_reason text,
  created_by_owner_id uuid references public.owner(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rookie_draft_lottery_reveal (
  id uuid primary key default gen_random_uuid(),
  lottery_id uuid not null references public.rookie_draft_lottery(id) on delete cascade,
  reveal_index integer not null,
  draft_position integer not null,
  franchise_id uuid not null references public.franchise(id),
  revealed_at timestamptz not null default now(),
  unique (lottery_id, reveal_index)
);
create index if not exists rookie_draft_lottery_reveal_lottery_idx on public.rookie_draft_lottery_reveal(lottery_id);

alter table public.rookie_draft_lottery enable row level security;
alter table public.rookie_draft_lottery_reveal enable row level security;
revoke all on table public.rookie_draft_lottery from anon, authenticated;
revoke all on table public.rookie_draft_lottery_reveal from anon, authenticated;
grant select, insert, update, delete on table public.rookie_draft_lottery to service_role;
grant select, insert, update, delete on table public.rookie_draft_lottery_reveal to service_role;
