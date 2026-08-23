-- Public Supabase Storage bucket for franchise team-logo uploads, replacing
-- the Manus Forge-backed object storage used before the Vercel migration.
-- Public buckets serve objects via their public URL without requiring a
-- storage.objects RLS policy, so none is needed here.
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;
