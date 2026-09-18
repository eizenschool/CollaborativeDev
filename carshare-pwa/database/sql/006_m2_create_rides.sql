-- Module 2 (Ride Sharing Management)
-- Creates `rides`, read/written by RideService.js. Drafted alongside the
-- Module 1 tables because RideService.js already queries it (Module 1's
-- profile card shows on ride listings, and Module 1 needed a runnable
-- end-to-end schema to demo Sign Up -> Profile -> Ride Hub). Module 2's
-- owner (Yee Zu Yao) should review/confirm this before the team treats it
-- as final - see docs/ai/modules/M2_RIDE_SHARING.md and
-- docs/ai/DECISIONS.md "Open Decisions: final ride/trip domain model".
-- Depends on 001_m1_create_profiles.sql, 002_m1_create_vehicles.sql.

create table rides (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  pickup text not null,
  destination text not null,
  date date not null,
  time text not null,
  journey_scale text not null check (journey_scale in ('Urban','Intercity')),
  seats_total int not null check (seats_total between 1 and 8),
  seats_available int not null check (seats_available >= 0),
  contribution text default '',
  restriction_tags text[] not null default '{}',
  status text not null default 'Draft'
    check (status in ('Draft','Published','Matched','In Transit','Completed','Cancelled')),
  created_at timestamptz not null default now()
);
