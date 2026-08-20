import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../../database/sql/028_m2_route_schedule_and_completion.sql', import.meta.url);
const sharedRouteUrl = new URL('../../../supabase/functions/_shared/m2Routes.ts', import.meta.url);
const quoteFunctionUrl = new URL('../../../supabase/functions/m2-route-quote/index.ts', import.meta.url);
const locationInputUrl = new URL('../../presentation/components/maps/ConfirmedLocationInput.jsx', import.meta.url);
const rideServiceUrl = new URL('../RideService.js', import.meta.url);
const rideRequestServiceUrl = new URL('../RideRequestService.js', import.meta.url);

describe('Module 2 route schedule and lifecycle contracts', () => {
  it('serializes Driver publication and applies half-open ETA intervals', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('from public.profiles');
    expect(sql).toContain('for update;');
    expect(sql).toContain("r.status = 'In Transit'");
    expect(sql).toContain('r.departure_at < p_schedule_buffer_until');
    expect(sql).toContain('p_departure_at < r.schedule_buffer_until');
    expect(sql).toContain("r.schedule_buffer_until is null");
    expect(sql).toContain("interval '30 minutes'");
  });

  it('uses one hour for publish, request cutoff, and reopening', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql.match(/interval '1 hour'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toContain("interval '5 hours'");
    expect(sql).toContain('Published rides must depart at least 1 hour from now');
    expect(sql).toContain('Requests close 1 hour before departure');
    expect(sql).toContain('Recruitment can only reopen at least 1 hour before departure');
  });

  it('keeps route anchors and lifecycle verification outside public tables', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('create table private.m2_ride_verification');
    expect(sql).toContain('revoke all on table private.m2_ride_verification from public, anon, authenticated');
    expect(sql).toContain('revoke select (waypoints) on public.rides from anon');
    expect(sql).toContain('grant select (estimated_arrival_at) on public.rides to anon');
    expect(sql).toContain('revoke select on table public.rides from authenticated');
    expect(sql).toContain('get_participant_ride_detail');
    expect(sql).not.toMatch(/grant select \([^)]*(route_quote_id|check_in_distance_meters|arrival_confirmed_at)[^)]*\)[^;]*to anon/s);
  });

  it('keeps the undeployed-027 Host edit fallback private and vehicle-aware', async () => {
    const service = await readFile(rideServiceUrl, 'utf8');
    expect(service).toContain('LEGACY_HOST_RIDE_SELECT');
    expect(service).toContain('data.host_id === sessionData.session.user.id');
    expect(service).toContain('vehicle_id ?? row.vehicleId');
  });

  it('disambiguates every ride host profile embed by its foreign key', async () => {
    const [rideService, rideRequestService] = await Promise.all([
      readFile(rideServiceUrl, 'utf8'),
      readFile(rideRequestServiceUrl, 'utf8')
    ]);
    expect(rideService.match(/host:profiles!rides_host_id_fkey\(/g)?.length).toBe(3);
    expect(rideRequestService.match(/host:profiles!rides_host_id_fkey\(/g)?.length).toBe(2);
    expect(rideService).not.toMatch(/host:profiles\(/);
    expect(rideRequestService).not.toMatch(/host:profiles\(/);
    expect(rideRequestService).toContain('requester:profiles!ride_requests_requester_id_fkey(');
  });

  it('enforces GPS, No-show, dual confirmation, and 24-hour completion in RPCs', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('p_accuracy_meters > 100');
    expect(sql).toContain('if v_distance > 200');
    expect(sql).toContain("boarding_status = 'No-show'");
    expect(sql).toContain("boarding_status = 'Checked In'");
    expect(sql).toContain("passenger_confirmation_due_at = now() + interval '24 hours'");
    expect(sql).toContain('arrival_confirmed_at is null');
    expect(sql).toContain('v.passenger_confirmation_due_at <= now()');
  });

  it('uses an encrypted signed five-minute quote and consumes quota before Routes', async () => {
    const [shared, edge] = await Promise.all([
      readFile(sharedRouteUrl, 'utf8'),
      readFile(quoteFunctionUrl, 'utf8')
    ]);
    expect(shared).toContain('ROUTE_QUOTE_TTL_MS = 5 * 60 * 1000');
    expect(shared).toContain('ROUTE_DAILY_LIMIT = 250');
    expect(shared).toContain('AES-GCM');
    expect(shared).toContain('HMAC');
    expect(shared).toContain('routingPreference: "TRAFFIC_AWARE"');
    expect(edge.indexOf('await rpc<void>("preflight_m2_route_quote"')).toBeLessThan(edge.indexOf('await rpc<number>("consume_m2_route_quota"'));
    expect(edge.indexOf('await rpc<number>("consume_m2_route_quota"')).toBeLessThan(edge.indexOf('const route = await computeRoute(ride, googleKey)'));
  });

  it('debounces for one second and invalidates stale suggestion sequences', async () => {
    const input = await readFile(locationInputUrl, 'utf8');
    expect(input).toContain('window.setTimeout(async () =>');
    expect(input).toContain('LOCATION_SEARCH_DEBOUNCE_MS');
    expect(input).toContain('window.clearTimeout(timer)');
    expect(input.match(/sequence !== requestSequence\.current/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
