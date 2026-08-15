// ===== BUSINESS LOGIC (FR-6.7 place classification) =====
//
// Extracted from index.ts so it can be tested. It was previously inline in an
// Edge Function whose first two lines import `jsr:` and `npm:` specifiers, which
// no Vitest run can load - so the one piece of ingestion logic that had already
// produced a systematic, catalogue-wide failure was also the only piece with no
// test able to reach it. Nothing in this file imports anything, so Deno bundles
// it and Node runs it unchanged.
//
// The history matters, because the same bug has now been found twice:
//
//   1. Kuala Lumpur, first pass. Classification scanned a fixed category order
//      and returned the first category holding *any* of a place's types.
//      `tourist_attraction` sat in the heritage list and nearly every landmark
//      carries it, so heritage swallowed the catalogue and nature and event came
//      back empty. Fixed by checking Google's own `primaryType` first.
//
//   2. Penang / Melaka / Selangor. That fix was applied to the `primaryType`
//      branch only. The `types` fallback kept the original fixed order with
//      culinary ahead of heritage, so Cheong Fatt Tze - The Blue Mansion, a
//      UNESCO heritage house with a restaurant in it, came back culinary - the
//      exact failure the first fix was written for. Meanwhile the final line
//      returned "event" for anything unrecognised, quietly making that category
//      the catalogue's dumping ground for hotels and a shopping mall.
//
// So the rule this file encodes is: what a place *is* outranks what it merely
// contains, and something that cannot be classified is not a destination.

/** The four categories FR-6.7 classifies into. `null` means "not a destination". */
export type PlaceCategory = "culinary" | "nature" | "heritage" | "event";

// Carried by almost every landmark, park and theme park Google returns, so
// these say "somewhere worth visiting" and nothing about which category. They
// are never a specific match, only a last-resort signal.
export const GENERIC_TYPES = ["tourist_attraction", "point_of_interest", "establishment"];

export const CATEGORY_TYPES: Record<PlaceCategory, string[]> = {
  culinary: [
    "restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery",
    "food", "ice_cream_shop", "coffee_shop",
  ],
  nature: [
    "park", "natural_feature", "national_park", "state_park", "beach",
    "campground", "hiking_area", "zoo", "aquarium",
  ],
  heritage: [
    "museum", "tourist_attraction", "historical_landmark", "castle",
    "church", "mosque", "hindu_temple", "buddhist_temple", "place_of_worship",
  ],
  event: [
    // `water_park` is here rather than in nature because two Selangor water
    // parks - Sunway Lagoon and Wet World Shah Alam - came back as nature on
    // the Selangor ingestion. A water park is a built attraction; the word
    // "park" in its type is not the same word as the one in `national_park`.
    "event_venue", "amusement_park", "water_park", "performing_arts_theater",
    "stadium",
  ],
};

// Places that are somewhere to sleep, shop or bury someone rather than somewhere
// to travel to. The catalogue sweep asks for `restaurant` and `tourist_attraction`
// among others, and hotels and malls carry both, so they arrive whether or not
// they are wanted; this is where they are turned away.
//
// Matched on `primaryType` only - Google's own single classification - never on
// the `types` bag. A bag match would exclude real destinations by accident:
// `lodging` appears on campgrounds, which are a nature category above.
export const EXCLUDED_PRIMARY_TYPES = [
  "hotel", "motel", "resort_hotel", "extended_stay_hotel", "bed_and_breakfast",
  "guest_house", "hostel", "inn", "lodging",
  "shopping_mall", "department_store",
  "cemetery", "funeral_home",
];

// Culinary is last on purpose. A restaurant inside a heritage house, a cafe in
// a museum and a food court in a theme park are facilities, not the reason to
// travel there - so any other category naming the place wins over culinary.
// This ordering is the whole fix for failure (2) above and the reason
// `blue mansion` has a test of its own.
const FALLBACK_ORDER: PlaceCategory[] = ["nature", "event", "heritage", "culinary"];

// The same order with culinary removed, used whenever the place is already known
// to be a destination and only its category is in question. Menara KL is why
// this exists: its primary type is the generic `tourist_attraction` and the only
// specific type in its bag is `restaurant`, so scanning the full order would
// file the observation tower under culinary - the original failure (1).
const DESTINATION_ORDER: PlaceCategory[] = ["nature", "event", "heritage"];

function specificTypes(category: PlaceCategory): string[] {
  return CATEGORY_TYPES[category].filter((type) => !GENERIC_TYPES.includes(type));
}

function categoryOfSpecificType(type: string): PlaceCategory | null {
  if (!type) return null;
  // The four specific-type lists are disjoint, so a single type resolves to at
  // most one category and the order of this loop cannot matter.
  for (const category of FALLBACK_ORDER) {
    if (specificTypes(category).includes(type)) return category;
  }
  return null;
}

function firstMatchingCategory(types: string[], order: PlaceCategory[]): PlaceCategory | null {
  for (const category of order) {
    if (types.some((type) => specificTypes(category).includes(type))) return category;
  }
  return null;
}

/**
 * FR-6.7. The category a place belongs to, or `null` when it is not a
 * destination at all and should not enter the catalogue.
 */
export function classifyPlace(types: string[] = [], primaryType = ""): PlaceCategory | null {
  const safeTypes = Array.isArray(types) ? types.filter((t) => typeof t === "string") : [];
  const primary = typeof primaryType === "string" ? primaryType : "";

  // 1. Google's own classification, when it names a real category. This is the
  //    single most reliable signal and is why failure (1) stopped happening.
  const byPrimary = categoryOfSpecificType(primary);
  if (byPrimary) return byPrimary;

  // 2. A hotel, mall or cemetery - unless its types name a heritage category,
  //    which is the case of a historic building that also takes guests. The
  //    rescue is deliberately heritage-only: every hotel has a restaurant, so
  //    allowing culinary to rescue one would let all of them back in, and
  //    allowing nature would keep a memorial park that carries `park`.
  if (EXCLUDED_PRIMARY_TYPES.includes(primary)) {
    return firstMatchingCategory(safeTypes, ["heritage"]);
  }

  // 3. Google calls it a destination but will not say what kind. Its category
  //    comes from the type bag, minus culinary - a landmark's restaurant is a
  //    facility, not the reason to travel. Both of the historical failures live
  //    on this branch: Gurney Bay Park needs the bag consulted at all (it was
  //    hardcoded to heritage and the place is a park), and Menara KL needs
  //    culinary kept out of it.
  if (GENERIC_TYPES.includes(primary)) {
    return firstMatchingCategory(safeTypes, DESTINATION_ORDER) || "heritage";
  }

  // 4. No usable primary type at all. The full order, culinary last.
  const byTypes = firstMatchingCategory(safeTypes, FALLBACK_ORDER);
  if (byTypes) return byTypes;

  // 5. Nothing specific matched, but a generic type still says this is somewhere
  //    people visit. Heritage is the widest of the four and the least wrong
  //    place to put an unlabelled landmark.
  if (safeTypes.some((t) => GENERIC_TYPES.includes(t))) return "heritage";

  // 6. Unclassifiable and not even generically a destination. This used to
  //    return "event", which is how four hotels and a shopping mall ended up
  //    filed as events.
  return null;
}
