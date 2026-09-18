// FR-6.7 classification. This logic had produced two catalogue-wide failures
// before it had a single test, because it lived inside an Edge Function that no
// Vitest run could import. The cases below are the real places each failure was
// found on, with the type bags Google actually returns for them.
//
// If a weight or an ordering is changed and one of these flips, the change has
// reintroduced a bug that reached the live catalogue once already.
import { describe, it, expect } from 'vitest';
import { classifyPlace, resolveCategory, EXCLUDED_PRIMARY_TYPES } from '../classification.ts';

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
  // The first version of this test asserted heritage against a type bag that
  // was invented rather than observed - `historical_landmark` alongside the
  // hotel - and passed, which is why the rule it was guarding shipped broken.
  // The bag below is the live response, taken from the function's own skip
  // report. Google supplies no heritage signal for this place at all.
  const BLUE_MANSION = ['hotel', 'lodging', 'restaurant', 'food', 'point_of_interest', 'establishment'];

  it('cannot classify the Blue Mansion from Google\'s data, and says so', () => {
    expect(classifyPlace(BLUE_MANSION, 'hotel')).toBeNull();
  });

  it('keeps the Blue Mansion once the catalogue already holds a judgement', () => {
    // 032 set this by hand. A gap in the rules must not discard it.
    expect(resolveCategory(classifyPlace(BLUE_MANSION, 'hotel'), 'heritage'))
      .toEqual({ category: 'heritage', retained: true });
  });

  it('still turns the Blue Mansion away if it is genuinely new', () => {
    // The same bag with nothing in the catalogue is indistinguishable from an
    // ordinary hotel, and is treated as one.
    expect(resolveCategory(classifyPlace(BLUE_MANSION, 'hotel'), null)).toBeNull();
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

describe('a built attraction with grounds is an event, not nature', () => {
  // Found on the Penang nature top-up: "The TOP Penang, Theme Park Penang" was
  // discovered by a nature-only sweep - so it does carry a nature type - and
  // the old order checked nature before event, so it was filed as nature.
  it('prefers an event type over a nature type in the same bag', () => {
    expect(classifyPlace(['park', 'amusement_park', 'tourist_attraction'], 'tourist_attraction'))
      .toBe('event');
    expect(classifyPlace(['aquarium', 'amusement_park'], 'tourist_attraction')).toBe('event');
  });

  it('classifies The TOP Penang from its real Google response', () => {
    // Copied from the live row. `aquarium` and `museum` in the bag are what
    // pulled it into nature, and `amusement_center` is its primaryType - a
    // value the event list did not originally hold, so it resolved by the
    // weaker fallback even once the ordering was fixed.
    const types = [
      'aquarium', 'bridge', 'tourist_attraction', 'lounge_bar', 'amusement_park',
      'amusement_center', 'spa', 'night_club', 'museum', 'transportation_service',
      'bar', 'event_venue', 'association_or_organization', 'restaurant', 'food',
      'point_of_interest', 'establishment',
    ];
    expect(classifyPlace(types, 'amusement_center')).toBe('event');
    // And still event if Google ever stops naming a primary type for it.
    expect(classifyPlace(types, '')).toBe('event');
  });

  it('leaves a nature place with no event type alone', () => {
    // The ordering must only bite when an event type is genuinely present.
    expect(classifyPlace(['park', 'tourist_attraction'], 'tourist_attraction')).toBe('nature');
    expect(classifyPlace(['national_park', 'hiking_area'], 'national_park')).toBe('nature');
    expect(classifyPlace(['zoo', 'tourist_attraction'], 'zoo')).toBe('nature');
    expect(classifyPlace(['aquarium'], 'aquarium')).toBe('nature');
    expect(classifyPlace(['beach', 'natural_feature'], 'beach')).toBe('nature');
  });

  it('still lets Google\'s primaryType override the ordering entirely', () => {
    // A national park that hosts an annual event venue is still a national park
    // if that is what Google calls it.
    expect(classifyPlace(['national_park', 'event_venue'], 'national_park')).toBe('nature');
  });
});

describe('excluded primary types are rescued only by heritage', () => {
  it('keeps a historic building that also takes guests, when Google says so', () => {
    // This clause only fires when the bag actually carries a heritage type.
    // The Blue Mansion's does not - see above - so this is the narrower case
    // of a hotel Google has additionally labelled a museum, not the general
    // answer to "heritage building operating as a hotel".
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

describe('resolveCategory - the rules decide new places, not existing ones', () => {
  it('uses the classified category when there is one', () => {
    expect(resolveCategory('nature', 'culinary')).toEqual({ category: 'nature', retained: false });
    // A rule change is still allowed to *re*classify a known place. This is
    // what moved The TOP Penang from nature to event on the backfill.
    expect(resolveCategory('event', 'nature')).toEqual({ category: 'event', retained: false });
  });

  it('falls back to the catalogue only when the rules found nothing', () => {
    expect(resolveCategory(null, 'heritage')).toEqual({ category: 'heritage', retained: true });
  });

  it('rejects an unclassifiable place that is genuinely new', () => {
    expect(resolveCategory(null, null)).toBeNull();
    expect(resolveCategory(null, undefined)).toBeNull();
    expect(resolveCategory(null, '')).toBeNull();
    expect(resolveCategory(null, '   ')).toBeNull();
  });

  it('never returns a blank category, because the column is not null', () => {
    const result = resolveCategory(null, 'culinary');
    expect(result.category).toBe('culinary');
    expect(result.category.length).toBeGreaterThan(0);
  });
});

describe('malformed input does not throw', () => {
  it('tolerates missing, null and non-string values', () => {
    expect(classifyPlace()).toBeNull();
    expect(classifyPlace(null, null)).toBeNull();
    expect(classifyPlace([null, 42, 'museum'], undefined)).toBe('heritage');
  });
});
