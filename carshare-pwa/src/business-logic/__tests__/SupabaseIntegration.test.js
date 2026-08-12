import { describe, expect, it } from 'vitest';
import { buildSignUpResult } from '../AuthService.js';
import { mapProfileRow } from '../ProfileService.js';
import { buildVehicleRecord } from '../VehicleService.js';
import {
  buildRideInsert,
  buildRidePatch,
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

    const mapped = mapRideRow({
      id: 'ride-a', host_id: 'user-a', pickup: 'KL Sentral', destination: 'Ipoh',
      date: '2026-08-20', time: '09:30', journey_scale: 'Intercity', vehicle_id: 'vehicle-a',
      seats_total: 3, seats_available: 3, contribution: 'Toll', restriction_tags: [],
      waypoints: insert.waypoints, status: 'Draft', created_at: '2026-08-12T00:00:00Z', host: null
    });
    expect(mapped.waypoints[1].description).toBe('Coffee stop');
    expect(buildRidePatch({ waypoints: ['Kampar'] })).toEqual({
      waypoints: [{ name: 'Kampar', description: '' }]
    });
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
