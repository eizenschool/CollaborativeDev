-- Module 6 Destination Discovery: place catalogue, interest, notification
-- registrations, and stated travel preferences.
--
-- COMPLIANCE NOTE (accepted risk, recorded deliberately):
-- Google Maps Platform terms permit indefinite storage of place IDs only; names,
-- ratings, review counts, review text and photographs are to be requested live
-- and displayed with attribution rather than warehoused. This schema caches
-- rating, review_count, description and photo_references because the module's
-- architecture depends on it: FR-6.11 forbids enrichment at request time, and the
-- Desirability formula takes rating and review_count as inputs on every scoring
-- pass. The team has accepted this as a known limitation for an academic
-- prototype. It is documented in docs/ai/modules/M6_DESTINATION_DISCOVERY.md and
-- must be carried into the report's limitations section rather than left
-- unstated. Only photo *references* are stored here - image bytes are never
-- copied into project Storage.

-- ---------------------------------------------------------------------------
-- Place catalogue
-- ---------------------------------------------------------------------------

create table public.places (
  id uuid primary key default gen_random_uuid(),

  -- FR-6.2: the source identifier is the upsert key, so re-ingestion updates
  -- rather than duplicating. This is also the one field the Google terms allow
  -- to be stored indefinitely.
  source_place_id text not null unique,

  name text not null,

  -- FR-6.7: exactly one category per place.
  category text not null
    check (category in ('culinary', 'heritage', 'nature', 'event')),

  -- FR-6.8/6.9/6.10: either a generated single-sentence summary or a category
  -- template. The flag records which, so the presentation tier and the
  -- validation-rejection path stay distinguishable after the fact.
  description text not null default '',
  description_is_template boolean not null default true,

  rating numeric(2,1) check (rating is null or rating between 1 and 5),
  review_count integer not null default 0 check (review_count >= 0),

  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),

  -- Malaysian state. Scopes chain detection (FR-6.26) and the visitation
  -- headroom peer group, both of which are meaningless nationally.
  state text not null default '',

  -- FR-6.13/6.14: up to five photo references with their attribution.
  -- References only; the images themselves are fetched live at display time.
  photo_references jsonb not null default '[]'::jsonb,

  -- FR-6.3/6.4/6.5 lifecycle. `state_before_demotion` is what makes restoration
  -- return a place to what it was rather than to a default.
  lifecycle_state text not null default 'Pending Enrichment'
    check (lifecycle_state in
      ('Pending Enrichment', 'Active', 'Provisional', 'Stale', 'Retired')),
  state_before_demotion text
    check (state_before_demotion is null or state_before_demotion in
      ('Active', 'Provisional')),
  absence_counter integer not null default 0 check (absence_counter >= 0),

  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Candidate selection filters by lifecycle state then by locality, so the
-- partial index carries only rows that can actually be recommended - Retired and
-- Pending Enrichment places are withheld (FR-6.4) and never appear in a query.
create index places_recommendable_idx
  on public.places (state, category)
  where lifecycle_state in ('Active', 'Provisional', 'Stale');

-- Chain detection counts name recurrence within one state (FR-6.26).
create index places_state_name_idx on public.places (state, lower(name));

-- The ingestion cycle sweeps by absence counter to find demotion candidates.
create index places_absence_idx on public.places (absence_counter)
  where absence_counter > 0;

-- ---------------------------------------------------------------------------
-- Recorded interest (FR-6.30, aggregated into latent demand by FR-6.31)
-- ---------------------------------------------------------------------------

create table public.place_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,

  -- The travel window the interest was expressed for. Interest in a place for
  -- next weekend says nothing about next year, so demand is always counted
  -- against a window rather than against the place alone.
  travel_date date not null,

  created_at timestamptz not null default now(),

  -- US-6.3: interest is recorded exactly once per selection, so a user opening
  -- the same destination five times is one interested user, not five.
  constraint place_interest_once_per_window_key
    unique (user_id, place_id, travel_date)
);

create index place_interest_user_idx on public.place_interest (user_id);
-- Demand aggregation groups by (place, window); this index serves that directly.
create index place_interest_demand_idx
  on public.place_interest (place_id, travel_date);

-- ---------------------------------------------------------------------------
-- Ride availability notification registrations (FR-6.33)
-- ---------------------------------------------------------------------------

create table public.ride_notify_registration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  travel_date date not null,

  status text not null default 'active'
    check (status in ('active', 'fulfilled', 'expired', 'cancelled')),

  created_at timestamptz not null default now(),
  closed_at timestamptz,

  -- UC6.6 A1: a second registration shows the existing one rather than creating
  -- a duplicate.
  constraint ride_notify_registration_once_key
    unique (user_id, place_id, travel_date)
);

create index ride_notify_registration_user_idx
  on public.ride_notify_registration (user_id);
-- UC6.12 matches a newly published ride against outstanding registrations.
create index ride_notify_registration_open_idx
  on public.ride_notify_registration (place_id, travel_date)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Stated travel preferences (FR-6.21, the middle tier of the FR-6.20 fallback)
-- ---------------------------------------------------------------------------

create table public.user_travel_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferred_categories text[] not null default '{}',

  -- UC6.4 A1: the prompt is not re-presented after dismissal, and affinity falls
  -- to the neutral value.
  prompt_dismissed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.places enable row level security;
alter table public.place_interest enable row level security;
alter table public.ride_notify_registration enable row level security;
alter table public.user_travel_preferences enable row level security;

-- The catalogue is shared, read-only to every signed-in user. All writes belong
-- to the scheduled ingestion pipeline running as service_role: this module has
-- no administrative actor and no user-facing path that edits a place.
create policy "authenticated users read the place catalogue"
  on public.places for select to authenticated
  using (true);

-- auth.uid() is wrapped in a scalar subquery throughout so it is evaluated once
-- per statement rather than once per row.
create policy "users read their own interest"
  on public.place_interest for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users record their own interest"
  on public.place_interest for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users withdraw their own interest"
  on public.place_interest for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own registrations"
  on public.ride_notify_registration for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users create their own registrations"
  on public.ride_notify_registration for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users update their own registrations"
  on public.ride_notify_registration for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users read their own preferences"
  on public.user_travel_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users write their own preferences"
  on public.user_travel_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users revise their own preferences"
  on public.user_travel_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.places from public, anon, authenticated;
revoke all on table public.place_interest from public, anon, authenticated;
revoke all on table public.ride_notify_registration from public, anon, authenticated;
revoke all on table public.user_travel_preferences from public, anon, authenticated;

grant select on table public.places to authenticated;
grant select, insert, delete on table public.place_interest to authenticated;
grant select, insert, update on table public.ride_notify_registration to authenticated;
grant select, insert, update on table public.user_travel_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- Latent demand (FR-6.31, consumed by the Accessibility demand signal and by the
-- host-facing unmet demand view in FR-6.34)
-- ---------------------------------------------------------------------------

-- Demand has to be counted across all users, but no user may see *who* else is
-- interested - only how many. RLS on place_interest correctly hides other users'
-- rows, so the count is produced by a security definer function that returns
-- aggregates and never the underlying identities.
create or replace function public.place_latent_demand(p_travel_date date)
returns table (place_id uuid, interested_users integer)
language sql
security definer
set search_path = ''
as $$
  select pi.place_id, count(distinct pi.user_id)::integer
  from public.place_interest pi
  where pi.travel_date = p_travel_date
  group by pi.place_id;
$$;

revoke all on function public.place_latent_demand(date)
  from public, anon, authenticated;
grant execute on function public.place_latent_demand(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Cross-module read interface (FR-6.36 for Module 4, FR-6.37 for Module 2)
-- ---------------------------------------------------------------------------

-- Module 4 filters rides by proximity to landmarks and Module 2 tags waypoints
-- along a route. Both query this catalogue rather than maintaining their own, so
-- one refreshed dataset serves three modules. Retired places are excluded here
-- rather than by each caller, so the withholding rule cannot be forgotten.
create or replace function public.places_near_point(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision,
  p_category text default null
)
returns setof public.places
language sql
stable
set search_path = ''
as $$
  select p.*
  from public.places p
  where p.lifecycle_state in ('Active', 'Provisional', 'Stale')
    and (p_category is null or p.category = p_category)
    -- Great-circle distance in kilometres; mean earth radius 6371.
    and 6371 * acos(
          least(1, greatest(-1,
            cos(radians(p_lat)) * cos(radians(p.lat))
              * cos(radians(p.lng) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(p.lat))
          ))
        ) <= p_radius_km;
$$;

revoke all on function public.places_near_point(double precision, double precision, double precision, text)
  from public, anon;
grant execute on function public.places_near_point(double precision, double precision, double precision, text)
  to authenticated;
