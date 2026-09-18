-- Module 1 (User Profile & Reputation)
-- Auto-creates a `profiles` row (and a matching `host_impact_stats` row)
-- whenever someone signs up via supabase.auth.signUp. AuthService.js passes
-- full_name/phone in the signUp call's `options.data` - this trigger reads
-- them back out of `raw_user_meta_data` and mirrors them into the public
-- schema. Without this, ProfileService.getProfile() would find nothing for
-- a brand-new user.
--
-- Runs as `security definer` so it can insert into `profiles` on behalf of a
-- user who doesn't have insert access to that table themselves (see RLS in
-- 005_m1_enable_rls.sql - the client itself is never granted `insert` on
-- profiles, only `update`/`delete` on its own row).
-- Depends on 001_m1_create_profiles.sql and 003_m1_create_host_impact_stats.sql.

create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', '')
  );
  insert into public.host_impact_stats (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
