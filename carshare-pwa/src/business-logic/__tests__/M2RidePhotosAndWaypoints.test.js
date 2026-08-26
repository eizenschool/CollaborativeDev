import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  PICKUP_PHOTO_SOURCE_MAX_BYTES,
  validatePickupPhoto,
} from '../RidePickupPhotoService.js';
import { validWaypointStopMinutes } from '../../presentation/components/ride/PublishRide.jsx';

const migration = new URL('../../../database/sql/059_m2_ride_pickup_destination_photos.sql', import.meta.url);
const expiredPhotoMigration = new URL('../../../database/sql/063_m2_expired_passenger_destination_photos.sql', import.meta.url);
const uploadReturnMigration = new URL('../../../database/sql/060_m2_allow_pickup_photo_upload_return.sql', import.meta.url);
const edgeFunction = new URL('../../../supabase/functions/m2-ride-pickup-photo/index.ts', import.meta.url);
const publishRide = new URL('../../presentation/components/ride/PublishRide.jsx', import.meta.url);
const rideCard = new URL('../../presentation/components/ride/RideCard.jsx', import.meta.url);
const searchCards = new URL('../../presentation/components/search/RideCards.jsx', import.meta.url);
const rideRequestService = new URL('../RideRequestService.js', import.meta.url);
const destinationPhoto = new URL('../../presentation/components/ride/DestinationRidePhoto.jsx', import.meta.url);
const rideDetail = new URL('../../presentation/components/ride/RideDetail.jsx', import.meta.url);

describe('Module 2 waypoint and Ride photo contracts', () => {
  it('accepts only whole stop durations from 0 through 180 minutes', () => {
    expect(validWaypointStopMinutes('0')).toBe(0);
    expect(validWaypointStopMinutes('30')).toBe(30);
    expect(validWaypointStopMinutes('180')).toBe(180);
    expect(validWaypointStopMinutes('-1')).toBeNull();
    expect(validWaypointStopMinutes('181')).toBeNull();
    expect(validWaypointStopMinutes('4.5')).toBeNull();
    expect(validWaypointStopMinutes('')).toBeNull();
  });

  it('validates source photo MIME and the 10 MB pre-processing boundary', () => {
    expect(validatePickupPhoto({ size: 1024, type: 'image/webp' })).toBeTruthy();
    expect(validatePickupPhoto({ size: 1024, type: 'image/jpeg' })).toBeTruthy();
    expect(() => validatePickupPhoto({ size: 1024, type: 'image/gif' })).toThrow(/JPEG, PNG, or WebP/);
    expect(() => validatePickupPhoto({ size: PICKUP_PHOTO_SOURCE_MAX_BYTES + 1, type: 'image/png' })).toThrow(/10 MB/);
  });

  it('keeps pickup objects private and exposes only bounded, visibility-checked RPCs', async () => {
    const [sql, uploadReturnSql, edge] = await Promise.all([
      readFile(migration, 'utf8'), readFile(uploadReturnMigration, 'utf8'), readFile(edgeFunction, 'utf8'),
    ]);
    expect(sql).toMatch(/'ride-pickup-photos',\r?\n\s+false,\r?\n\s+2097152/);
    expect(sql).toContain('create or replace function public.set_ride_pickup_photo');
    expect(sql).toContain('cardinality(p_ride_ids) > 100');
    expect(sql).toContain("r.status = 'Published' and p.status = 'active'");
    expect(sql).toContain('grant execute on function public.get_public_ride_pickup_context(uuid) to anon, authenticated');
    expect(sql).not.toContain('grant select on storage.objects');
    expect(uploadReturnSql).toContain('on storage.objects for select to authenticated');
    expect(uploadReturnSql).toContain("bucket_id = 'ride-pickup-photos'");
    expect(uploadReturnSql).toContain('owner_id = (select auth.uid())::text');
    expect(uploadReturnSql).toContain('r.host_id = (select auth.uid())');
    expect(uploadReturnSql).toContain("r.status in ('Draft', 'Published')");
    expect(uploadReturnSql).toContain("rr.status = 'Accepted'");
    expect(edge).toContain('createSignedUrl(ride.pickup_photo_path, 300)');
    expect(edge).toContain('ride.status === "Published" && host?.status === "active"');
    expect(edge).toContain('.eq("status", "Accepted")');
  });

  it('renders custom waypoint controls and keeps pickup photos off every Ride card', async () => {
    const [publish, workspace, search, detail] = await Promise.all([
      readFile(publishRide, 'utf8'), readFile(rideCard, 'utf8'), readFile(searchCards, 'utf8'), readFile(rideDetail, 'utf8'),
    ]);
    expect(publish).toContain('waypoint-recommendation-duration');
    expect(publish).toContain('waypoint-selected-duration');
    expect(publish).not.toContain("'Included'");
    expect(publish).toContain('setRouteQuote(null)');
    expect(workspace).toContain('<DestinationRidePhoto');
    expect(workspace).toContain('className="pin pin-destination"');
    expect(workspace).toContain('className="ride-route-connector" aria-hidden="true"');
    expect(search).toContain('<DestinationRidePhoto');
    expect(workspace).not.toContain('PickupPhotoPreview');
    expect(search).not.toContain('PickupPhotoPreview');
    expect(detail).toContain('pickup-photo-public');
    expect(detail).toContain('variant="detail"');
  });

  it('loads destination photography lazily with attribution and non-nested card navigation', async () => {
    const [photo, workspace, requests] = await Promise.all([
      readFile(destinationPhoto, 'utf8'), readFile(rideCard, 'utf8'), readFile(rideRequestService, 'utf8')
    ]);
    expect(photo).toContain('IntersectionObserver');
    expect(photo).toContain('loading="lazy"');
    expect(photo).toContain('alt=""');
    expect(photo).toContain('Google Maps');
    expect(workspace).toContain('<article className=');
    expect(workspace).toContain('className="ride-card-primary-action"');
    expect(workspace).not.toContain('<button className={\'ride-card\'');
    expect(requests).toContain('attachRequestRidePhotoPlaceIds');
    expect(requests).toContain('attachDestinationPhotoPlaceIds');
  });

  it('keeps expired accepted passengers eligible for destination card photos', async () => {
    const sql = await readFile(expiredPhotoMigration, 'utf8');
    expect(sql).toContain("rr.status = 'Accepted'");
    expect(sql).toContain("r.status = 'Expired'");
    expect(sql).toContain("rr.status = 'Expired'");
    expect(sql).toContain("to_jsonb(rr)->>'accepted_at' is not null");
  });
});
