-- Cosmetic-only data fix, not a schema change. Reworks transaction.summary text to
-- match the two wording changes made in the code at the same time (commissioner call,
-- Sept 30 2026):
--
--   1. Free-agent-period waiver claims no longer state a dollar figure at all --
--      "<franchise> claimed <player> (free agent period)." -- instead of any of the
--      three earlier wordings this codebase has produced for the same event:
--        "... claimed <player> for $1 (free agent period)."                 (original bug)
--        "... claimed <player> for $1 (free agent period) (<period label>)." (original bug, batch path)
--        "... claimed <player> for $0 FAAB ($1 salary[, free agent period]).(<period label>)?" (interim fix, 9def162)
--      The real $0 FAAB / $1 salary split is unaffected and stays recorded in
--      details->>'amount' / details->>'salary' for anyone auditing -- this migration
--      also backfills those on any row still carrying the old amount:1.
--
--   2. Drop/release transactions drop the "with no contract penalty" clause entirely,
--      since CVC cuts never carry a contract penalty and saying so every single time
--      added nothing: "<franchise> released <player> with no contract penalty." ->
--      "<franchise> released <player>."
--
-- Why "transaction_type = 'waiver' and summary like '% claimed %'" safely identifies
-- every free-agent-period claim, across every historical wording: the bid-cycle award
-- path has always said "won ... for $X FAAB (<period label>)." and never "claimed" --
-- only the free-period path has ever used that verb, in every version of this code
-- (confirmed by reading server/waiverResolution.ts's full history). So this cannot
-- touch a real bid-cycle waiver win.
--
-- Safe to re-run: after the first run, no row matches ' for $' anymore (free-period) or
-- 'with no contract penalty' (drops), so every statement becomes a no-op.

begin;

-- Preview before running for real, if you want to see which rows will change:
--   select id, summary from public.transaction
--     where transaction_type = 'waiver' and summary like '% claimed % for $%';
--   select id, summary from public.transaction
--     where transaction_type = 'drop' and summary like '% with no contract penalty.';

-- Free-agent-period claims: strip everything from " for $" onward (covers all three
-- historical wordings in one pass, since each one's divergence from the rest starts
-- exactly there) and replace with the new plain ending.
update public.transaction
set summary = regexp_replace(summary, ' for \$.*$', ' (free agent period).')
where transaction_type = 'waiver'
  and summary like '% claimed % for $%';

-- Backfill details->>'amount'/'salary' on any row still carrying the old $1-charges-FAAB
-- shape. Scoped by the now-normalized "(free agent period)." ending plus amount = '1' so
-- it only touches rows the first update (or an earlier, already-corrected deploy) left
-- with the wrong number -- a row already at amount: 0 is left alone.
update public.transaction
set details = details || jsonb_build_object('amount', 0, 'salary', 1)
where transaction_type = 'waiver'
  and summary like '% claimed % (free agent period).'
  and (details->>'amount') = '1';

-- Drops/releases: no contract penalty has ever applied to a CVC cut, so stop saying so.
update public.transaction
set summary = replace(summary, ' with no contract penalty.', '.')
where transaction_type = 'drop'
  and summary like '% with no contract penalty.';

commit;

-- Sanity check to run after: both should return zero rows.
--   select id, summary from public.transaction
--     where transaction_type = 'waiver' and summary like '% claimed % for $%';
--   select id, summary from public.transaction
--     where transaction_type = 'drop' and summary like '% with no contract penalty.';
