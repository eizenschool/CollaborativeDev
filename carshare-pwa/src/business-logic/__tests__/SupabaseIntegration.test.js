import { describe, expect, it } from 'vitest';
import { buildSignUpResult } from '../AuthService.js';
import { mapProfileRow } from '../ProfileService.js';
import { buildVehicleRecord } from '../VehicleService.js';
import {
  buildRideInsert,
  buildRidePatch,
  buildRideRpcArgs,
  mapRideRow,
  validateRideDraft
} from '../RideService.js';
import { DemoClockService } from '../verification/DemoClockService.js';

describe('Supabase integration contracts', () => {
  it('does not treat an unverified sign-up as a logged-in session', () => {
    const result = buildSignUpResult({
      authUser: { id: 'user-a', email: 'person@example.com' },
      session: null,
      appUser: null
    });

    expect(result).toEqual({
      user: null,
      email: 'person@example.com',
      requiresEmailConfirmation: true
    });
  });

  it('returns the hydrated app user when sign-up creates a session', () => {
    const appUser = { id: 'user-a', fullName: 'Alya', email: 'alya@example.com' };
    const result = buildSignUpResult({
      authUser: { id: 'user-a', email: 'alya@example.com' },
      session: { access_token: 'test' },
      appUser
    });

    expect(result.user).toBe(appUser);
    expect(result.requiresEmailConfirmation).toBe(false);
  });

  it('hydrates safe profile and private fields while sourcing email from Auth', () => {
    const appUser = mapProfileRow({
      id: 'user-a',
      full_name: 'Alya Tan',
      profile_photo_url: 'https://example.com/avatar.png',
      status: 'active',
      created_at: '2026-08-12T00:00:00Z',
      profile_private: {
        phone: '+60123456789',
        emergency_contact: { name: 'Mira', phone: '+60987654321', relationship: 'Friend' }
      }
    }, { email: 'auth-source@example.com' });

    expect(appUser.email).toBe('auth-source@example.com');
    expect(appUser.phone).toBe('+60123456789');
    expect(appUser.emergencyContact.name).toBe('Mira');
  });

  it('omits a null vehicle id so Postgres can generate its UUID default', () => {
    const record = buildVehicleRecord('user-a', {
      id: null,
      make: ' Perodua ',
      model: ' Myvi ',
      plate: ' VAA 1234 ',
      driverLicenseNumber: ' D1234567 ',
      colour: ' Blue ',
      seats: 4,
      year: 2024,
      active: false,
      unexpected: 'must not be sent'
    });

    expect(record).not.toHaveProperty('id');
    expect(record).not.toHaveProperty('unexpected');
    expect(record).toMatchObject({
      owner_id: 'user-a',
      make: 'Perodua',
      plate: 'VAA 1234',
      driver_license_number: 'D1234567'
    });
  });

  it('persists and hydrates ride waypoints', () => {
    const insert = buildRideInsert('user-a', {
      pickup: 'KL Sentral',
      destination: 'Ipoh',
      pickupLocation: { latitude: 3.139, longitude: 101.6869, placeId: 'pickup-place' },
      destinationLocation: { placeId: 'destination-place' },
      pickupInstructions: ' Meet beside Entrance A. ',
      date: '2026-08-20',
      time: '09:30',
      journeyScale: 'Intercity',
      vehicleId: 'vehicle-a',
      seatsTotal: 3,
      contribution: 'Toll',
      restrictionTags: ['No smoking'],
      waypoints: ['Tapah', { name: 'Gopeng', description: 'Coffee stop' }]
    }, 'Draft');

    expect(insert.waypoints).toEqual([
      { name: 'Tapah', description: '' },
      { name: 'Gopeng', description: 'Coffee stop' }
    ]);
    expect(insert).toMatchObject({
      pickup_place_id: 'pickup-place',
      pickup_latitude: 3.139,
      pickup_longitude: 101.6869,
      destination_place_id: 'destination-place',
      pickup_instructions: 'Meet beside Entrance A.'
    });

    const mapped = mapRideRow({
      id: 'ride-a', host_id: 'user-a', pickup: 'KL Sentral', destination: 'Ipoh',
      pickup_place_id: 'pickup-place', pickup_latitude: 3.139, pickup_longitude: 101.6869,
      destination_place_id: 'destination-place', pickup_instructions: 'Meet beside Entrance A.',
      date: '2026-08-20', time: '09:30', journey_scale: 'Intercity', vehicle_id: 'vehicle-a',
      seats_total: 3, seats_available: 3, contribution: 'Toll', restriction_tags: [],
      waypoints: insert.waypoints, status: 'Draft', created_at: '2026-08-12T00:00:00Z', host: null
    });
    expect(mapped.waypoints[1].description).toBe('Coffee stop');
    expect(mapped.pickupLocation).toMatchObject({ source: 'device', placeId: 'pickup-place', latitude: 3.139 });
    expect(mapped.destinationLocation).toEqual({ source: 'place', placeId: 'destination-place' });
    expect(mapped.pickupInstructions).toBe('Meet beside Entrance A.');
    expect(buildRideRpcArgs({
      pickup: 'KL Sentral', destination: 'Ipoh',
      pickupLocation: { latitude: 3.139, longitude: 101.6869, placeId: 'pickup-place' },
      destinationLocation: { placeId: 'destination-place' },
      pickupInstructions: ' Meet beside Entrance A. ',
      departureAt: '2026-08-20T01:30:00.000Z', journeyScale: 'Intercity',
      vehicleId: 'vehicle-a', seatsTotal: 3
    })).toMatchObject({
      p_pickup_place_id: 'pickup-place',
      p_pickup_latitude: 3.139,
      p_pickup_longitude: 101.6869,
      p_destination_place_id: 'destination-place',
      p_pickup_instructions: 'Meet beside Entrance A.'
    });
    expect(buildRidePatch({ waypoints: ['Kampar'] })).toEqual({
      waypoints: [{ name: 'Kampar', description: '' }]
    });
  });

  it('keeps legacy rides readable without confirmed location references', () => {
    const mapped = mapRideRow({
      id: 'legacy-ride', host_id: 'user-a', pickup: 'Old pickup', destination: 'Old destination',
      departure_at: '2026-08-20T01:30:00.000Z', journey_scale: 'Urban',
      seats_total: 2, seats_available: 2, status: 'Draft', host: null
    });
    expect(mapped.pickupLocation).toBeNull();
    expect(mapped.destinationLocation).toBeNull();
    expect(mapped.pickupInstructions).toBe('');
  });

  it('keeps legacy location columns and pickup instructions nullable in SQL history', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/020_m2_add_route_locations.sql', import.meta.url),
      'utf8'
    ));
    expect(sql).toContain('add column pickup_place_id text');
    expect(sql).toContain('add column pickup_instructions text,');
    expect(sql).toContain('rides_pickup_coordinates_pair_check');
    expect(sql).toContain("Legacy route locations cannot be changed without confirmed location references");
    expect(sql).toContain('grant execute on function public.create_ride');
    expect(sql).toContain('grant execute on function public.update_ride');
  });

  it('keeps Realtime read receipts idempotent in SQL history', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/021_m3_stabilize_realtime_reads.sql', import.meta.url),
      'utf8'
    ));
    expect(sql).toContain('and (last_read_at is null or last_read_at < v_latest)');
    expect(sql).toContain('set last_read_at = v_latest');
    expect(sql).toContain('set search_path =');
    expect(sql).toContain('revoke all on function public.mark_conversation_read');
    expect(sql).toContain('grant execute on function public.mark_conversation_read');
  });

  it('allows current conversation members to sign private chat media without listing the bucket', async () => {
    const sql = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../database/sql/022_m3_allow_member_media_signing.sql', import.meta.url),
      'utf8'
    ));
    expect(sql).toContain("'storage.object.sign'");
    expect(sql).toContain("'storage.object.sign_many'");
    expect(sql).toContain('private.conversation_is_visible');
    expect(sql).not.toContain("'storage.object.list'");
  });

  it('requires complete route and schedule data for drafts too', () => {
    expect(() => validateRideDraft({
      pickup: 'KL Sentral',
      destination: '',
      date: '',
      time: '',
      journeyScale: 'Urban',
      seatsTotal: 3
    })).toThrow('Destination is required.');

    expect(() => validateRideDraft({
      pickup: 'KL Sentral',
      destination: 'Ipoh',
      date: '2026-08-20',
      time: '09:30',
      journeyScale: 'Intercity',
      seatsTotal: 3,
      vehicleId: null
    })).toThrow('Choose one of your vehicles.');
  });

  it('keeps the Module 6 demo clock on its local adapter', () => {
    expect(DemoClockService.backend).toBe('local');
  });
});
