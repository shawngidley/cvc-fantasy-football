-- Free-period claims (period_type = 'free') are NOT auto-awarded like bid-period FAAB
-- claims are -- per commissioner, the claiming owner must explicitly confirm their own
-- claim before it can be awarded. A claim never confirmed before the free period
-- closes is dropped entirely (no award), same as any other losing claim.
--
-- NULL = not yet confirmed. Bid-period (FAAB) claims are stamped at submission time
-- (see submitFaabBid) since they were never subject to this requirement -- this column
-- is meaningful only for period_type = 'free' rows.
alter table public.faab_bid add column if not exists confirmed_at timestamptz;
