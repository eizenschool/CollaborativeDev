import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../../data-access/supabaseClient.js', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc }
}));

import {
  CONFIRMED_ROUTE_RPC_TEXT_LIMIT,
  RideService,
  confirmedRouteTextForRpc
} from '../RideService.js';

describe('Module 4 confirmed route RPC text', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it('keeps the full label in criteria while limiting only the RPC fallback prefix', () => {
    const label = `TAR UMT ${'long formatted address '.repeat(10)}`.trim();

    expect(label.length).toBeGreaterThan(CONFIRMED_ROUTE_RPC_TEXT_LIMIT);
    expect(confirmedRouteTextForRpc(label)).toBe(label.slice(0, CONFIRMED_ROUTE_RPC_TEXT_LIMIT));
    expect(confirmedRouteTextForRpc('   ')).toBeNull();
  });

  it('limits confirmed direct and multi-leg RPC route labels without changing Place IDs', async () => {
    const pickup = 'P'.repeat(180);
    const destination = 'D'.repeat(190);

    await RideService.searchRides({
      from: pickup,
      to: destination,
      confirmedLocations: {
        pickupPlaceId: 'pickup-place-id',
        destinationPlaceId: 'destination-place-id'
      }
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'search_public_rides_with_confirmed_locations', expect.objectContaining({
      p_pickup: pickup.slice(0, CONFIRMED_ROUTE_RPC_TEXT_LIMIT),
      p_destination: destination.slice(0, CONFIRMED_ROUTE_RPC_TEXT_LIMIT),
      p_pickup_place_id: 'pickup-place-id',
      p_destination_search_place_id: 'destination-place-id'
    }));

    await RideService.searchMultiLegRides({
      pickup,
      destination,
      pickupPlaceId: 'pickup-place-id',
      destinationSearchPlaceId: 'destination-place-id',
      minSeats: 1,
      tags: []
    });

    expect(rpc).toHaveBeenNthCalledWith(2, 'search_public_multi_leg_journeys_with_confirmed_locations', expect.objectContaining({
      p_pickup: pickup.slice(0, CONFIRMED_ROUTE_RPC_TEXT_LIMIT),
      p_destination: destination.slice(0, CONFIRMED_ROUTE_RPC_TEXT_LIMIT),
      p_pickup_place_id: 'pickup-place-id',
      p_destination_search_place_id: 'destination-place-id'
    }));
  });
});
