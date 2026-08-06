# Connecting this project to Supabase

Right now every screen runs against `src/data-access/mockDataStore.js` - an
in-memory/localStorage store, not a real backend. This guide switches the app
over to a real Supabase project. **No component code changes** - every service
in `src/business-logic/` already branches on `isSupabaseConfigured` and calls
Supabase instead of the mock store the moment your `.env` is filled in.

## 0. What you're connecting

| Module | Tables it needs |
|---|---|
| Module 1 (Profile & Reputation) | `profiles`, `vehicles`, `host_impact_stats` |
| Module 2 (Ride Sharing) | `rides` (reads `profiles` + `host_impact_stats` too, for the host card on each ride) |
| Modules 3-6 (Messaging, Search, Trip Management, Verification) | not built yet - add their tables the same way, following the pattern below |

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick any name/region, and set a database password (save it somewhere - you won't need it for this app, but you'll want it if you ever open the SQL editor's "reset" flow).
2. Once it's provisioned, open **Project Settings → API**. You need two values:
   - **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
   - **anon / public key** (a long JWT string - NOT the `service_role` key, that one must never go in client code)

## 2. Point the app at it

In the project root:

```bash
cp .env.example .env
```

Fill in the two values from step 1:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Restart `npm run dev` after saving `.env` (Vite only reads env files on startup). At this point `isSupabaseConfigured` becomes `true` and every service switches over - but the tables don't exist yet, so every request will fail until you run the schema below.

## 3. Run the schema

Open your project's **SQL Editor** (left sidebar) → **New query**, paste the whole block below, and run it. It's written to match exactly what the existing service files already query - the column names here are not arbitrary, they're read straight out of `ProfileService.js`, `VehicleService.js`, `HostImpactEngine.js`, and `RideService.js`.

```sql
-- ============================================================
-- profiles - Module 1 (User Profile & Reputation)
-- One row per auth user. id is a foreign key to Supabase's own
-- auth.users table, so it's created automatically by the trigger
-- at the bottom, not by the app's Sign Up form directly.
-- ============================================================
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

-- ============================================================
-- vehicles - Module 1 (My Vehicles)
-- ============================================================
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

-- ============================================================
-- host_impact_stats - Module 1 (Reputation & Impact) / Host Impact Engine
-- One row per user. rating is the public 0-5 "star" average shown on Ride
-- Hub cards (Module 2 FR-2.12 Rate & Review) - it's a placeholder column
-- until that screen is built; everything else feeds the Composite Impact
-- Score formula in HostImpactEngine.js.
-- ============================================================
create table host_impact_stats (
  user_id uuid primary key references profiles(id) on delete cascade,
  completed_trips int not null default 0,
  co2_saved_kg numeric not null default 0,
  reputation_score int not null default 50 check (reputation_score between 0 and 100),
  rating numeric check (rating between 0 and 5),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- rides - Module 2 (Ride Sharing Management)
-- ============================================================
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

-- ============================================================
-- Auto-create a profiles row whenever someone signs up via
-- supabase.auth.signUp (AuthService.js passes full_name/phone in
-- the signUp options.data - this trigger reads them back out).
-- Without this, ProfileService.getProfile() would find nothing
-- for a brand-new user.
-- ============================================================
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
```

## 4. Turn on Row Level Security (RLS)

Supabase leaves RLS off by default on new tables, which means anyone with your anon key could read/write every row. Turn it on and add policies:

```sql
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table host_impact_stats enable row level security;
alter table rides enable row level security;

-- profiles: you can read anyone's public info (name/photo shown on ride
-- cards), but only edit your own row.
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
-- writable by the client - only Module 6's verified-trip pipeline (or an
-- Edge Function / trigger you add later) should update these numbers.
create policy "impact stats are publicly readable" on host_impact_stats
  for select using (true);

-- rides: published rides are publicly browsable; a host can always see
-- and manage their own rides regardless of status (drafts included).
create policy "published rides are publicly readable" on rides
  for select using (status = 'Published' or auth.uid() = host_id);
create policy "hosts create their own rides" on rides
  for insert with check (auth.uid() = host_id);
create policy "hosts update their own rides" on rides
  for update using (auth.uid() = host_id);
create policy "hosts delete their own rides" on rides
  for delete using (auth.uid() = host_id);
```

## 5. Storage bucket for profile photos

`ProfileService.updateProfilePhoto` uploads to a bucket named `avatars`. Create it: **Storage → New bucket → name it `avatars` → Public bucket** (so the returned `getPublicUrl()` links actually resolve). If you'd rather keep photos private, make the bucket private and switch `getPublicUrl` to `createSignedUrl` in `ProfileService.js` - that's the only line that would need to change.

## 6. Try it

```bash
npm run dev
```

Sign up with a real email - you should see a new row appear in **Table Editor → profiles** and **host_impact_stats**. Add a vehicle, publish a ride, deactivate/delete the account - each should show up (or disappear) in the corresponding table in real time.

If a request fails, the browser console will show the Postgres/PostgREST error directly (missing column, RLS policy blocking the write, etc.) - that's almost always faster to debug than re-reading this guide.

## 7. Adding Module 3-6 tables later

Same three-step recipe every time:

1. Add the table in the SQL editor, snake_case columns, `references profiles(id)` for ownership.
2. Add RLS policies (start from the closest existing table above and adjust who can read vs. write).
3. In that module's business-logic service, branch on `isSupabaseConfigured` exactly like `RideService.js` does - snake_case in the Supabase query, mapped back to the camelCase shape the mock store already returns, so the presentation layer never has to know which backend is active.
