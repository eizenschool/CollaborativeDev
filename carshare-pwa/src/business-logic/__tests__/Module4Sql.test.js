import { describe, expect, it } from 'vitest';

describe('Module 4 SQL contract', () => {
  it('keeps migration sequence numbers unique', async () => {
    const migrations = await import('node:fs/promises').then(({ readdir }) => readdir(
      new URL('../../../database/sql/', import.meta.url)
    ));
    const sequenceNumbers = migrations
      .map((fileName) => fileName.match(/^(\d{3})_.*\.sql$/)?.[1])
      .filter(Boolean);

    expect(new Set(sequenceNumbers).size).toBe(sequenceNumbers.length);
  });

  it('locks favourites to authenticated owners and returns only safe ride-card fields', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/034_m4_smart_search_favourites.sql', import.meta.url),
      'utf8'
    ));
    expect(sql).toContain('alter table public.ride_favourites enable row level security');
    expect(sql).toContain('(select auth.uid()) = user_id');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('on conflict (user_id, ride_id) do nothing');
    expect(sql).toContain('grant execute on function public.list_my_favourite_rides() to authenticated');
    expect(sql).toContain('create function private.add_ride_favourite');
    expect(sql).toMatch(/create function public\.add_ride_favourite[\s\S]*?security invoker/i);
    expect(sql).not.toMatch(/create function public\.add_ride_favourite[\s\S]*?security definer/i);
    expect(sql).not.toContain('pickup_place_id');
    expect(sql).not.toContain('pickup_latitude');
    expect(sql).not.toContain('pickup_instructions');
  });

  it('exposes a public, bounded proximity RPC without leaking private ride locations', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/035_m4_destination_proximity_search.sql', import.meta.url),
      'utf8'
    ));
    const returnedColumns = sql.match(/returns table\s*\(([\s\S]*?)\)\s*language/i)?.[1] || '';

    expect(sql).toMatch(/create function private\.search_public_rides_near_destination[\s\S]*?security definer/i);
    expect(sql).toMatch(/create function public\.search_public_rides_near_destination[\s\S]*?security invoker/i);
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('p_radius_km not in (5, 10, 25)');
    expect(sql).toContain('d.distance_km <= p_radius_km');
    expect(sql).toContain("r.status = 'Published'");
    expect(sql).toContain('r.seats_available > 0');
    expect(sql).toContain("p.status = 'active'");
    expect(sql).toContain('to anon, authenticated');
    expect(sql).not.toContain('auth.uid()');
    expect(returnedColumns).not.toMatch(/place_id|latitude|longitude|pickup_instructions|waypoints|route_geometry/i);
  });

  it('adds bounded compatibility classifications behind a safe public search wrapper', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/039_m4_vehicle_language_filters.sql', import.meta.url),
      'utf8'
    ));
    const returnedColumns = sql.match(/returns table\s*\(([\s\S]*?)\)\s*language/i)?.[1] || '';

    expect(sql).toContain("vehicle_type in ('sedan', 'hatchback', 'suv', 'mpv', 'pickup', 'van', 'other')");
    expect(sql).toContain("'malay', 'english', 'mandarin', 'cantonese', 'tamil', 'other'");
    expect(sql).toMatch(/create(?: or replace)? function private\.search_public_rides_with_compatibility/i);
    expect(sql).toMatch(/create(?: or replace)? function public\.search_public_rides_with_compatibility[\s\S]*?security invoker/i);
    expect(sql).toContain('grant update (spoken_languages) on table public.profiles to authenticated');
    expect(sql).toContain('grant update (vehicle_type) on table public.vehicles to authenticated');
    expect(sql).toContain("r.status = 'Published'");
    expect(sql).toContain('r.seats_available > 0');
    expect(returnedColumns).not.toMatch(/place_id|latitude|longitude|pickup_instructions|waypoints|route_geometry|plate|make|model/i);
  });

  it('disambiguates the public Ride-to-Host relationship for PostgREST', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../RideService.js', import.meta.url),
      'utf8'
    ));

    expect(source).toContain('host:profiles!rides_host_id_fkey');
    expect(source).not.toMatch(/host:profiles\(id, full_name/);
  });
});
