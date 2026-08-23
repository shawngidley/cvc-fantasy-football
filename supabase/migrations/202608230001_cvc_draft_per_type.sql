-- Allow more than one draft per season (e.g. a rookie draft and an auction
-- draft both existing for the same season), scoped uniqueness to draft_type.
do $$
declare
  cname text;
begin
  select tc.constraint_name into cname
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'draft'
    and tc.constraint_type = 'UNIQUE'
    and ccu.column_name = 'season_id';

  if cname is not null then
    execute format('alter table public.draft drop constraint %I', cname);
  end if;
end $$;

alter table public.draft add constraint draft_season_id_draft_type_key unique (season_id, draft_type);
