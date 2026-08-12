-- Module 2 (Ride Sharing Management)
-- Enables RLS on `rides` and adds its policies. Depends on
-- 006_m2_create_rides.sql. Same review note as that file applies here.

alter table rides enable row level security;

-- published rides are publicly browsable; a host can always see and manage
-- their own rides regardless of status (drafts included).
create policy "published rides are publicly readable" on rides
  for select using (status = 'Published' or auth.uid() = host_id);
create policy "hosts create their own rides" on rides
  for insert with check (auth.uid() = host_id);
create policy "hosts update their own rides" on rides
  for update using (auth.uid() = host_id);
create policy "hosts delete their own rides" on rides
  for delete using (auth.uid() = host_id);
