import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPlace } = vi.hoisted(() => ({ getPlace: vi.fn() }));

vi.mock('../../discovery/DestinationDiscoveryService.js', () => ({
  DestinationDiscoveryService: { getPlace }
}));

import { TumpangGuideService } from '../TumpangGuideService.js';

describe('Tumpang Guide client reliability', () => {
  beforeEach(() => getPlace.mockReset());

  it('keeps a valid Edge answer when browser catalogue hydration returns no place', async () => {
    getPlace.mockResolvedValue(null);
    const response = {
      mode: 'place_info', traceId: 'edge-place-1', assistantMessage: 'Verified live guide.',
      recommendations: [], actions: [],
      placeInfo: {
        placeId: 'place-1', officialName: 'KL Bird Park', state: 'Kuala Lumpur',
        category: 'nature', summary: 'A grounded visitor guide.'
      }
    };

    await expect(TumpangGuideService.hydrateResponse(response)).resolves.toMatchObject({
      mode: 'place_info', traceId: 'edge-place-1', assistantMessage: 'Verified live guide.',
      catalogueHydrationWarning: true,
      placeInfo: { placeId: 'place-1', officialName: 'KL Bird Park', place: null }
    });
  });

  it('reuses a place already hydrated during Edge-response validation', async () => {
    const place = { id: 'place-1', name: 'KL Bird Park' };
    const response = {
      mode: 'recommend', traceId: 'edge-recommend-1', placeInfo: null, actions: [],
      recommendations: [{ placeId: 'place-1', place }]
    };

    const hydrated = await TumpangGuideService.hydrateResponse(response);

    expect(hydrated.recommendations[0].place).toBe(place);
    expect(getPlace).not.toHaveBeenCalled();
  });
});
