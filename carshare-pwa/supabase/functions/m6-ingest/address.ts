// ===== BUSINESS LOGIC (state resolution) =====
//
// Ingestion used to write `region.state` onto every row it created - the state
// named in the sweep's own configuration, not the state the place is actually
// in. A region is a circle, and a 50 km circle centred on George Town reaches
// well into Kedah, so the Penang sweep stored Dataran Kulim, Kulim Bird Park
// and Tupah Recreational Forest as Penang places.
//
// That is not only a display error. ChainDetection (FR-6.26) scores name
// recurrence *within a state*, so a wrong state silently changes which places
// are compared against each other - an outlet in Kedah mislabelled Penang can
// make a genuinely independent Penang business look like a chain, or hide a
// real chain by splitting it across two labels.
//
// Google already knows the answer and returns it in `addressComponents`, which
// is a Pro-tier field. The enrichment mask is already at Enterprise +
// Atmosphere because it asks for `reviews`, and Places API (New) prices a
// request at the highest tier present, so adding this costs nothing.
//
// Nothing here imports anything, for the same reason as classification.ts.

/** The Places component that carries the state, province or federal territory. */
const STATE_COMPONENT_TYPE = "administrative_area_level_1";

// Google's own spelling for a place is not always the spelling already in the
// catalogue, and a mismatch fragments the state grouping that ChainDetection
// and the UI both rely on: "Federal Territory of Kuala Lumpur" and "Kuala
// Lumpur" would become two different states holding twenty places between them.
//
// Only aliases actually observed or plainly expected for Malaysia are listed.
// An unrecognised state is passed through as Google spelled it rather than
// guessed at - a new state appearing under its own name is a much smaller
// problem than a wrong one appearing under a familiar name.
const STATE_ALIASES: Record<string, string> = {
  "federal territory of kuala lumpur": "Kuala Lumpur",
  "wilayah persekutuan kuala lumpur": "Kuala Lumpur",
  "kuala lumpur federal territory": "Kuala Lumpur",
  "federal territory of labuan": "Labuan",
  "wilayah persekutuan labuan": "Labuan",
  "federal territory of putrajaya": "Putrajaya",
  "wilayah persekutuan putrajaya": "Putrajaya",
  "pulau pinang": "Penang",
  "malacca": "Melaka",
  "negeri sembilan darul khusus": "Negeri Sembilan",
  "selangor darul ehsan": "Selangor",
  "kedah darul aman": "Kedah",
  "perak darul ridzuan": "Perak",
  "pahang darul makmur": "Pahang",
  "johor darul ta'zim": "Johor",
  "kelantan darul naim": "Kelantan",
  "terengganu darul iman": "Terengganu",
  "perlis indera kayangan": "Perlis",
};

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

/**
 * The state a place is actually in, from Google's own address breakdown.
 *
 * Falls back to `fallback` - the sweep region's configured state - only when
 * Google does not supply an `administrative_area_level_1` component at all.
 * That fallback is the old behaviour, kept deliberately: a place with no state
 * is worse than a place with an approximate one, because `places.state` is
 * `not null default ''` and an empty string would read as "in Malaysia" on the
 * detail screen.
 */
export function stateFromAddress(
  components: AddressComponent[] | undefined | null,
  fallback = "",
): string {
  if (!Array.isArray(components)) return fallback;

  for (const component of components) {
    if (!component || !Array.isArray(component.types)) continue;
    if (!component.types.includes(STATE_COMPONENT_TYPE)) continue;

    const raw = typeof component.longText === "string" ? component.longText.trim() : "";
    if (!raw) continue;

    return STATE_ALIASES[raw.toLowerCase()] || raw;
  }

  return fallback;
}
