-- Module 1 (User Profile & Reputation)
-- Enables Row Level Security on the three Module 1 tables and adds their
-- policies. RLS is off by default on new Supabase tables, which means
-- anyone holding the public anon key could otherwise read/write every row.
-- Depends on 001_m1_create_profiles.sql, 002_m1_create_vehicles.sql,
-- 003_m1_create_host_impact_stats.sql.

alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table host_impact_stats enable row level security;

-- profiles: you can read anyone's public info (name/photo shown on ride
-- cards), but only edit or delete your own row. No client-side `insert`
-- policy on purpose - rows are only ever created by the
-- handle_new_user trigger (004_m1_handle_new_user_trigger.sql).
create policy "profiles are publicly readable" on profiles
  for select using (true);
create policy "users can update their own profile" on profiles
  for update using (auth.uid() = id);
create policy "users can delete their own profile" on profiles
  for delete using (auth.uid() = id);

-- vehicles: publicly readable (needed for ride cards / vehicle picker),
-- but only the owner can create/edit/delete their own.
create policy "vehicles are publicly readable" on vehicles
  for select using (true);
create policy "owners manage their own vehicles" on vehicles
  for insert with check (auth.uid() = owner_id);
create policy "owners update their own vehicles" on vehicles
  for update using (auth.uid() = owner_id);
create policy "owners delete their own vehicles" on vehicles
  for delete using (auth.uid() = owner_id);

-- host_impact_stats: publicly readable (ride card tier badges), never
-- writable by the client - no insert/update/delete policy at all. Only
-- Module 6's verified-trip pipeline (or a future Edge Function/trigger)
-- should update these numbers, using the service_role key server-side.
create policy "impact stats are publicly readable" on host_impact_stats
  for select using (true);
