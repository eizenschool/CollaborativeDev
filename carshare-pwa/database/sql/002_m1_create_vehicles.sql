-- Module 1 (User Profile & Reputation)
-- Creates `vehicles` for the "My Vehicles" panel (VehicleService.js).
-- Depends on 001_m1_create_profiles.sql (owner_id references profiles.id).

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  make text not null,
  model text not null,
  plate text not null,
  colour text default '',
  seats int not null check (seats between 1 and 8),
  year int not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
