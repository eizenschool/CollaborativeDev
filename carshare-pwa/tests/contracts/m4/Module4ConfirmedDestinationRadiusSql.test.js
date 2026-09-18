import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(
  import.meta.dirname,
  '../../../database/sql/117_m4_confirmed_destination_radius_search.sql'
), 'utf8');

describe('Module 4 confirmed-destination radius SQL contract', () => {
  it('keeps verified Ride anchors private behind narrow invoker wrappers', () => {
    expect(migration).toMatch(/create function private\.search_public_rides_near_confirmed_destination[\s\S]*?security definer/i);
    expect(migration).toMatch(/create function public\.search_public_rides_near_confirmed_destination[\s\S]*?security invoker/i);
    expect(migration).toMatch(/create function private\.search_public_multi_leg_journeys_near_confirmed_destination[\s\S]*?security definer/i);
    expect(migration).toMatch(/create function public\.search_public_multi_leg_journeys_near_confirmed_destination[\s\S]*?security invoker/i);
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('to anon, authenticated');
  });

  it('validates coordinates and supported inclusive radii', () => {
    expect(migration).toContain('p_center_latitude not between -90 and 90');
    expect(migration).toContain('p_center_longitude not between -180 and 180');
    expect(migration).toContain('p_radius_km not in (5, 10, 25)');
    expect(migration).toContain('m.distance_km <= p_radius_km');
    expect(migration).toContain('private.m2_ride_verification');
    expect(migration).toContain('private.m2_distance_metres');
  });

  it('returns only existing safe fields and a computed distance', () => {
    const returnedColumns = [...migration.matchAll(/returns table\s*\(([\s\S]*?)\)\s*language/gi)]
      .map((match) => match[1]);
    expect(returnedColumns).toHaveLength(4);
    for (const columns of returnedColumns) {
      expect(columns).not.toMatch(/place_id|latitude|longitude|pickup_instructions|waypoints|route_geometry/i);
    }
    for (const privateKey of ['pickupPlaceId', 'destinationPlaceId', 'pickupInstructions', 'waypoints', 'routeGeometry']) {
      expect(migration).not.toContain(`'${privateKey}'`);
    }
  });
});
