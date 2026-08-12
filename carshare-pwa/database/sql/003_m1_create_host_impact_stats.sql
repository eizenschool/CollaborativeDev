-- Module 1 (User Profile & Reputation)
-- Creates `host_impact_stats`: one row per user, feeding the Reputation &
-- Impact panel and HostImpactEngine.js's Composite Impact Score formula.
-- `rating` is a placeholder 0-5 "star" average for Module 2's Rate & Review
-- screen (FR-2.12), not yet built.
-- Depends on 001_m1_create_profiles.sql.
--
-- Open question (see docs/ai/modules/M1_PROFILE_REPUTATION.md "Open
-- Questions"): the exact Reputation/Host Impact formula and weights are not
-- finalised. This table only defines storage, not the formula.

create table host_impact_stats (
  user_id uuid primary key references profiles(id) on delete cascade,
  completed_trips int not null default 0,
  co2_saved_kg numeric not null default 0,
  reputation_score int not null default 50 check (reputation_score between 0 and 100),
  rating numeric check (rating between 0 and 5),
  updated_at timestamptz not null default now()
);
