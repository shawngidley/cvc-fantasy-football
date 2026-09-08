-- Owner-submitted website feedback/suggestions, shown to the whole league with the
-- submitter's franchise name and timestamp attached.
create table if not exists public.site_suggestion (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  owner_id uuid not null references public.owner(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists site_suggestion_created_at_idx on public.site_suggestion(created_at desc);

alter table public.site_suggestion enable row level security;
revoke all on table public.site_suggestion from anon, authenticated;
grant select on table public.site_suggestion to anon, authenticated;
grant select, insert, update, delete on table public.site_suggestion to service_role;
