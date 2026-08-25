-- Closes a race condition in startRookieLottery: the check-then-insert
-- (query for an existing RUNNING/PAUSED lottery, then insert a new one if
-- none found) is not atomic at the application level, so two
-- near-simultaneous start requests (a double-click, or two tabs/devices)
-- could both pass the check before either insert lands, creating two
-- active lottery rows for the same draft/round. The "most recent lottery"
-- query would then flip between them across polls -- each with its own
-- started_at/revealed_count -- so revealed_count could never reliably
-- climb to franchise_count for either row, and completion (which only
-- fires at that point) would never trigger.

-- Self-healing cleanup: if duplicate RUNNING/PAUSED rows already exist for
-- the same (draft_id, round_number) -- which the unique index below can't
-- be created on top of -- keep only the one with the latest started_at
-- (the "real" one the commissioner most recently interacted with) and
-- mark every other duplicate ABORTED, so this migration is safe to run
-- regardless of current state.
with ranked as (
  select id, row_number() over (partition by draft_id, round_number order by started_at desc nulls last, created_at desc) as rn
  from public.rookie_draft_lottery
  where status in ('RUNNING', 'PAUSED')
)
update public.rookie_draft_lottery l
set status = 'ABORTED', aborted_at = now(), abort_reason = 'Auto-aborted: duplicate concurrent lottery row detected and cleaned up during migration.', updated_at = now()
from ranked r
where l.id = r.id and r.rn > 1;

-- This partial unique index makes duplicates impossible going forward:
-- only one RUNNING or PAUSED row can ever exist per (draft_id,
-- round_number). A racing second insert now fails outright with a unique
-- violation instead of silently succeeding.
create unique index if not exists rookie_draft_lottery_one_active_idx
  on public.rookie_draft_lottery (draft_id, round_number)
  where status in ('RUNNING', 'PAUSED');
