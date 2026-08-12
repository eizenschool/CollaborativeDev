-- Module 1 (User Profile & Reputation)
-- Creates `profiles`: one row per auth user, holding the public/profile
-- fields ProfileService.js reads and writes. `id` is a foreign key into
-- Supabase Auth's own `auth.users` table, so this row is populated by the
-- trigger in 004_m1_handle_new_user_trigger.sql, not by the Sign Up form
-- inserting directly.
--
-- Status: drafted from docs/SUPABASE-SETUP.md for Module 1 (owner: Daniel
-- Lim Dong Hen). Not yet run against a live Supabase project - see
-- docs/ai/SQL.md "Current Status" and docs/ai/DECISIONS.md before treating
-- this as final/team-adopted.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text default '',
  emergency_contact jsonb not null default '{"name":"","phone":"","relationship":""}'::jsonb,
  profile_photo_url text,
  status text not null default 'active' check (status in ('active','deactivated')),
  created_at timestamptz not null default now()
);
