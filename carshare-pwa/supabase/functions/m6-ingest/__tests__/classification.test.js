// FR-6.7 classification. This logic had produced two catalogue-wide failures
// before it had a single test, because it lived inside an Edge Function that no
// Vitest run could import. The cases below are the real places each failure was
// found on, with the type bags Google actually returns for them.
//
// If a weight or an ordering is changed and one of these flips, the change has
// reintroduced a bug that reached the live catalogue once already.
import { describe, it, expect } from 'vitest';
import { classifyPlace, EXCLUDED_PRIMARY_TYPES } from '../classification.ts';

describe('classifyPlace - Google\'s own primary classification wins', () => {
  it('takes primaryType over anything in the type bag', () => {
    // The bag says restaurant; Google says museum. Google wins.
    expect(classifyPlace(['restaurant', 'establishment'], 'museum')).toBe('heritage');
    expect(classifyPlace(['museum', 'establishment'], 'restaurant')).toBe('culinary');
  });

  it('classifies an ordinary place of each category', () => {
    expect(classifyPlace(['restaurant'], 'restaurant')).toBe('culinary');
    expect(classifyPlace(['park'], 'park')).toBe('nature');
    expect(classifyPlace(['museum'], 'museum')).toBe('heritage');
    expect(classifyPlace(['stadium'], 'stadium')).toBe('event');
  });
});

describe('regression: heritage must not be swallowed by an incidental restaurant', () => {
  // Failure (2), found on the Penang ingestion. A UNESCO heritage house that
  // also operates as a boutique hotel and has a restaurant in it came back
  // culinary, and the detail screen showed "Culinary" above its own
  // description, "A museum in Penang."
  it('files Cheong Fatt Tze - The Blue Mansion as heritage, not culinary', () => {
    const types = [
      'historical_landmark', 'hotel', 'restaurant',
      'tourist_attraction', 'point_of_interest', 'establishment',
    ];
    expect(classifyPlace(types, 'hotel')).toBe('heritage');
  });

  // Failure (1), found on the Kuala Lumpur ingestion. An observation tower
  // whose primary type is the generic `tourist_attraction` and whose only
  // specific type is its restaurant.
  it('files Menara KL as heritage, not culinary', () => {
    const types = ['tourist_attraction', 'restaurant', 'point_of_interest', 'establishment'];
    expect(classifyPlace(types, 'tourist_attraction')).toBe('heritage');
  });

  it('still files a genuine restaurant that draws tourists as culinary', () => {
    // The guard above must not swing so far that a hawker centre stops being
    // somewhere to eat.
    const types = ['restaurant', 'food', 'tourist_attraction', 'point_of_interest'];
    expect(classifyPlace(types, 'restaurant')).toBe('culinary');
  });
});

describe('regression: a generic primary type must not hardcode heritage', () => {
  // Found on the Penang ingestion: the old code returned heritage the moment
  // primaryType was generic, without ever looking at the bag, so a seafront
  // park was filed as a heritage site.
  it('files Gurney Bay Park as nature', () => {
    const types = ['park', 'tourist_attraction', 'point_of_interest', 'establishment'];
    expect(classifyPlace(types, 'tourist_attraction')).toBe('nature');
  });

  it('falls back to heritage when the bag names nothing specific', () => {
    expect(classifyPlace(['tourist_attraction', 'point_of_interest'], 'tourist_attraction'))
      .toBe('heritage');
  });
});

describe('regression: event is not a dumping ground', () => {
  // Four hotels and a shopping mall were filed as events, because the old
  // final line returned "event" for anything it could not recognise.
  it('rejects a hotel rather than filing it as an event', () => {
    expect(classifyPlace(['hotel', 'lodging', 'point_of_interest'], 'hotel')).toBeNull();
  });

  it('rejects a hotel that has a restaurant in it', () => {
    // Every hotel does, which is why culinary may not rescue one.
    expect(classifyPlace(['hotel', 'lodging', 'restaurant'], 'hotel')).toBeNull();
  });

  it('rejects a shopping mall', () => {
    expect(classifyPlace(['shopping_mall', 'point_of_interest', 'establishment'], 'shopping_mall'))
      .toBeNull();
  });

  it('rejects a memorial park despite the park in its type bag', () => {
    // Nirvana Memorial Park is a columbarium. It was filed as nature.
    expect(classifyPlace(['funeral_home', 'cemetery', 'park'], 'funeral_home')).toBeNull();
  });

  it('rejects a place with no recognisable type at all', () => {
    expect(classifyPlace([], '')).toBeNull();
    expect(classifyPlace(['dentist'], 'dentist')).toBeNull();
  });

  it('files a real event venue as an event', () => {
    expect(classifyPlace(['amusement_park', 'tourist_attraction'], 'amusement_park'))
      .toBe('event');
  });

  it('files a water park as an event, not nature', () => {
    // Sunway Lagoon and Wet World Shah Alam both came back nature.
    expect(classifyPlace(['water_park', 'tourist_attraction'], 'water_park')).toBe('event');
  });
});

describe('excluded primary types are rescued only by heritage', () => {
  it('keeps a historic building that also takes guests', () => {
    expect(classifyPlace(['hotel', 'historical_landmark'], 'hotel')).toBe('heritage');
    expect(classifyPlace(['hotel', 'museum'], 'hotel')).toBe('heritage');
  });

  it('does not let nature rescue an excluded place', () => {
    // Otherwise every resort with a garden and every memorial park returns.
    expect(classifyPlace(['resort_hotel', 'park', 'beach'], 'resort_hotel')).toBeNull();
  });

  it('covers the accommodation types the sweep actually returns', () => {
    for (const type of ['hotel', 'motel', 'hostel', 'guest_house', 'lodging']) {
      expect(classifyPlace([type, 'point_of_interest'], type)).toBeNull();
    }
    expect(EXCLUDED_PRIMARY_TYPES).toContain('shopping_mall');
    expect(EXCLUDED_PRIMARY_TYPES).toContain('cemetery');
  });

  it('does not exclude a campground, which carries lodging but is a destination', () => {
    // This is why exclusion is matched on primaryType and never on the bag.
    expect(classifyPlace(['campground', 'lodging'], 'campground')).toBe('nature');
  });
});

describe('malformed input does not throw', () => {
  it('tolerates missing, null and non-string values', () => {
    expect(classifyPlace()).toBeNull();
    expect(classifyPlace(null, null)).toBeNull();
    expect(classifyPlace([null, 42, 'museum'], undefined)).toBe('heritage');
  });
});
