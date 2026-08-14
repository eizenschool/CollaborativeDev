// ===== DATA ACCESS LAYER (discoveryStore) =====
// Module 6 Destination Discovery's own store, on its own localStorage key so it
// never collides with mockDataStore or module6Store.
//
// Two jobs:
//   1. Hold the fixture catalogue that lets /discover run with no Google Places
//      key and no deployed `places` table - the same "clickable out of the box"
//      standard mockDataStore sets for Module 1.
//   2. Mirror the shape of the real Supabase calls, so when
//      `024_m6_destination_discovery.sql` is deployed the service layer swaps
//      source without a rewrite.
//
// The fixture is deliberately constructed so every scoring and lifecycle rule
// actually fires in a demo rather than being taken on trust:
//   - three same-named outlets in one state  -> chain detection (FR-6.26)
//   - a place with two reviews               -> Provisional + low-confidence
//                                               rating suppression (FR-6.16)
//   - a Stale place                          -> still recommended, ranked down
//   - a Retired place                        -> must never appear anywhere
//   - one category with no ride serving it   -> the unserved section

import { CATEGORY, PLACE_STATE } from '../business-logic/discovery/constants.js';
import { liveDiscoveryDb } from './discoverySupabaseRepository.js';

const STORAGE_KEY = 'letstumpang_discovery_v1';

// The live adapter is opt-in, and never under test. A developer with a working
// .env.local would otherwise point the whole suite at Supabase: the tests would
// make real network calls, depend on RLS and on whatever rows happen to exist,
// and fail outright on the fixture-only helpers the live adapter refuses to
// implement. The data source is a deployment choice, not a test fixture.
const USE_LIVE_DISCOVERY = import.meta.env?.MODE !== 'test'
  && import.meta.env.VITE_DISCOVERY_DATA_SOURCE?.trim() === 'supabase';

// A simulated round trip, so the screens exercise their loading states instead of
// resolving instantly and hiding them. Tests skip it: the orchestration calls
// this store several times per request, so keeping the delay made the suite
// spend most of its time asleep and turned a busy machine into a timeout.
const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 200;

// Photo references are stored, never image bytes - see the compliance note in
// `database/sql/024_m6_destination_discovery.sql`. In the fixture these are
// descriptive placeholders; the real ones come from Place Details.
const photo = (label, author) => ({ reference: `fixture:${label}`, attribution: author });

// FIXTURE CONTENT ONLY.
//
// Place Details returns up to five reviews per place, and those are what the
// detail screen is built to show. Until the live catalogue exists there is
// nothing to return, so these stand in - written in the register real reviews are
// written in, so the screen is laid out against realistic content rather than
// lorem ipsum. They are NOT presented as real reviews of real businesses and are
// replaced wholesale on first ingestion.
//
// `description` stays a single sentence throughout, because FR-6.8 specifies a
// single generated sentence. The depth on the detail screen comes from reviews
// and structured facts, not from writing longer editorial copy that the live
// system would never produce.
const review = (author, rating, text) => ({ author, rating, text });

const seedPlaces = [
  {
    id: 'p_georgetown',
    sourcePlaceId: 'fixture_georgetown',
    name: 'George Town Heritage Core',
    category: CATEGORY.HERITAGE,
    description: 'A UNESCO-listed street grid of shophouses, clan jetties and colonial facades.',
    descriptionIsTemplate: false,
    rating: 4.6,
    reviewCount: 18420,
    lat: 5.4141, lng: 100.3288,
    state: 'Penang',
    photoReferences: [photo('georgetown-1', 'Lim Wei Sheng'), photo('georgetown-2', 'Aisyah Roslan')],
    lifecycleState: PLACE_STATE.ACTIVE,
    // Hosts type a destination freehand, so the catalogue name and the ride text
    // rarely match exactly. Aliases bridge that until ingestion gives both sides
    // a shared Place ID - see DiscoveryContractAdapter.referencesPlace().
    rideDestinationAliases: ['Georgetown', 'Georgetown, Penang'],
    travelNote: 'About 4 hours north of Kuala Lumpur by road. The core is walkable end to end, so most visitors park once and stay on foot.',
    reviews: [
      review('Priya Devarajan', 5, 'Went for the street art and stayed for the clan jetties. Get there before nine if you want the lanes to yourself.'),
      review('Marcus Loh', 4, 'Beautiful, but genuinely hot by midday. The museums are a good way to break up the afternoon.'),
      review('Hannah Yusof', 5, 'Three days was not enough. Every second shophouse is a cafe, a workshop or somebody’s front room.')
    ]
  },
  {
    id: 'p_jonker',
    sourcePlaceId: 'fixture_jonker',
    name: 'Jonker Street',
    category: CATEGORY.CULINARY,
    description: 'A night market strip known for Peranakan kitchens and chicken rice balls.',
    descriptionIsTemplate: false,
    rating: 4.3,
    reviewCount: 9260,
    lat: 2.1958, lng: 102.2486,
    state: 'Melaka',
    photoReferences: [photo('jonker-1', 'Tan Boon Hock')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['Melaka Sentral', 'Melaka'],
    travelNote: 'Roughly 2 hours from Kuala Lumpur. The street closes to traffic on Friday, Saturday and Sunday evenings, which is when the night market runs.',
    reviews: [
      review('Chen Yi Ling', 5, 'Come hungry and start at the far end. The chicken rice ball queues get long after seven.'),
      review('Amir Hakim', 4, 'Packed on a Saturday night, much calmer on a weekday afternoon if crowds are not your thing.'),
      review('Grace Sim', 4, 'Half food, half antique shops. Worth wandering the side lanes rather than staying on the main strip.')
    ]
  },
  {
    id: 'p_cameron',
    sourcePlaceId: 'fixture_cameron',
    name: 'Cameron Highlands Tea Terraces',
    category: CATEGORY.NATURE,
    description: 'Terraced tea slopes and mossy forest trails at around 1,500 metres.',
    descriptionIsTemplate: false,
    rating: 4.5,
    reviewCount: 12100,
    lat: 4.4710, lng: 101.3776,
    state: 'Pahang',
    photoReferences: [photo('cameron-1', 'Nurul Huda')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'A 4 hour climb from Kuala Lumpur on winding road. Bring a jacket - it drops to around 15C at night, which catches most first-time visitors out.',
    reviews: [
      review('Daniel Ooi', 5, 'The tea terraces are the postcard shot, but the mossy forest trail was the part I remember.'),
      review('Siti Nurhaliza binti Rahman', 4, 'Weekends are bumper to bumper on the way up. Left at 6am on a Sunday and it was fine.'),
      review('Kelvin Tan', 4, 'Cool, green and quiet once you get off the main road. The strawberry farms are a tourist trap, skip them.')
    ]
  },
  {
    id: 'p_gurney',
    sourcePlaceId: 'fixture_gurney',
    name: 'Gurney Drive Hawker Centre',
    category: CATEGORY.CULINARY,
    description: 'A seafront hawker row where char kway teow and rojak stalls trade side by side.',
    descriptionIsTemplate: false,
    rating: 4.1,
    reviewCount: 7340,
    lat: 5.4380, lng: 100.3090,
    state: 'Penang',
    photoReferences: [photo('gurney-1', 'Kavitha Menon')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'On the Penang seafront, a short drive from George Town. Stalls open from late afternoon; most are cash only.',
    reviews: [
      review('Wong Mei Fong', 4, 'Char kway teow here is the benchmark. Sit at the plastic tables by the water.'),
      review('Ravi Chandran', 4, 'Touristy now, but the rojak and the cendol still hold up. Go on a weekday.'),
      review('Lisa Abdullah', 5, 'Sea breeze, cheap food, no pretence. Exactly what a hawker centre should be.')
    ]
  },
  {
    id: 'p_kellie',
    sourcePlaceId: 'fixture_kellie',
    name: "Kellie's Castle",
    category: CATEGORY.HERITAGE,
    description: 'An unfinished Scottish-Moorish mansion left half-built when its owner died in 1926.',
    descriptionIsTemplate: false,
    rating: 4.2,
    reviewCount: 3180,
    lat: 4.4690, lng: 101.0630,
    state: 'Perak',
    photoReferences: [photo('kellie-1', 'Daniel Wong')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'Near Batu Gajah in Perak, about 2.5 hours from Kuala Lumpur. Small site - an hour covers it, so most people pair it with Ipoh.',
    reviews: [
      review('Nathan Fernandez', 4, 'Smaller than the photos suggest, but the half-finished rooms are genuinely eerie.'),
      review('Aina Sofea', 5, 'The story behind it is better than the building. Read up before you go.'),
      review('Terence Lim', 3, 'Worth an hour if you are passing through Ipoh. Not worth a trip on its own.')
    ]
  },
  {
    id: 'p_sekinchan',
    sourcePlaceId: 'fixture_sekinchan',
    name: 'Sekinchan Paddy Fields',
    category: CATEGORY.NATURE,
    description: 'Flat rice terraces that turn from green to gold across the harvest cycle.',
    descriptionIsTemplate: false,
    rating: 4.4,
    reviewCount: 5210,
    lat: 3.5052, lng: 101.1015,
    state: 'Selangor',
    photoReferences: [photo('sekinchan-1', 'Farid Hakim')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['Cyberjaya', 'Cyberjaya, Selangor'],
    travelNote: 'About 1.5 hours north-west of Kuala Lumpur on the coast road. The fields are green after planting and gold before harvest - timing changes the whole trip.',
    reviews: [
      review('Yusof Kamal', 5, 'Went during harvest and the whole plain was gold. Completely different to the photos I had seen.'),
      review('Michelle Teoh', 4, 'Flat, open and very quiet. Good half day trip, pair it with the fishing village for seafood.'),
      review('Arun Segar', 4, 'Not much infrastructure - bring water and sun cover, there is no shade out there.')
    ]
  },

  // --- Provisional tier: two reviews. Rating must be suppressed in favour of a
  // low-confidence indicator (FR-6.16), and quality scores 1.0 x 0.2 = 0.20 even
  // though the raw rating is a perfect 5.0.
  {
    id: 'p_warung_mak_cik',
    sourcePlaceId: 'fixture_warung',
    name: 'Warung Mak Cik Zainab',
    category: CATEGORY.CULINARY,
    description: 'A roadside stall serving nasi lemak.',
    descriptionIsTemplate: true,
    rating: 5.0,
    reviewCount: 2,
    lat: 3.4900, lng: 101.1200,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.PROVISIONAL
  },

  // --- Chain detection: three outlets, same name, same state (FR-6.26). Their
  // local-economy signal must come out 0.0 while every independent place gets 1.0.
  {
    id: 'p_chain_a',
    sourcePlaceId: 'fixture_chain_a',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 4.0, reviewCount: 1450,
    lat: 3.1390, lng: 101.6869,
    state: 'Selangor',
    photoReferences: [photo('chain-a', 'Suresh Pillai')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['KLCC', 'Kuala Lumpur']
  },
  {
    id: 'p_chain_b',
    sourcePlaceId: 'fixture_chain_b',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 3.9, reviewCount: 980,
    lat: 3.0730, lng: 101.5180,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.ACTIVE
  },
  {
    id: 'p_chain_c',
    sourcePlaceId: 'fixture_chain_c',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 4.1, reviewCount: 1120,
    lat: 3.2100, lng: 101.7400,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.ACTIVE
  },

  // --- Stale: absent from three ingestion cycles. Still recommendable, ranked
  // down; restoring it must return it to Active, not to a default.
  {
    id: 'p_stale_gallery',
    sourcePlaceId: 'fixture_stale',
    name: 'Kuala Selangor Firefly Gallery',
    category: CATEGORY.NATURE,
    description: 'A riverside boardwalk for evening firefly viewing.',
    descriptionIsTemplate: false,
    rating: 4.0, reviewCount: 620,
    lat: 3.3400, lng: 101.2500,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.STALE,
    stateBeforeDemotion: PLACE_STATE.ACTIVE,
    absenceCounter: 4
  },

  // --- Retired: absent from ten cycles. Withheld from every list, but the row
  // and its recorded interest are preserved so a return restores both.
  {
    id: 'p_retired_museum',
    sourcePlaceId: 'fixture_retired',
    name: 'Closed Tin Mining Museum',
    category: CATEGORY.HERITAGE,
    description: 'A former tin dredge exhibit.',
    descriptionIsTemplate: true,
    rating: 3.5, reviewCount: 210,
    lat: 4.5900, lng: 101.0900,
    state: 'Perak',
    photoReferences: [],
    lifecycleState: PLACE_STATE.RETIRED,
    stateBeforeDemotion: PLACE_STATE.ACTIVE,
    absenceCounter: 11
  },

  // --- Peer places.
  //
  // Visitation headroom is measured against the highest review count among
  // candidates of the same category in the same state. A place that is the only
  // one of its category in its state is therefore trivially the most-visited in
  // its own group and scores 0 - which drags every score down and hides most of
  // the catalogue behind the presentation thresholds.
  //
  // That is an artefact of a small fixture, not of the rule: a real catalogue has
  // many places per category and state. These entries give each group actual
  // members so the anti-overtourism signal does what it is meant to - the busiest
  // place in a group scores 0, the quieter ones score high.
  {
    id: 'p_kek_lok_si',
    sourcePlaceId: 'fixture_kek_lok_si',
    name: 'Kek Lok Si Temple',
    category: CATEGORY.HERITAGE,
    description: 'A hillside temple complex crowned by a bronze statue of Kuan Yin.',
    descriptionIsTemplate: false,
    rating: 4.5, reviewCount: 9800,
    lat: 5.3993, lng: 100.2734,
    state: 'Penang',
    photoReferences: [photo('keklokis-1', 'Ong Chin Hui')],
    lifecycleState: PLACE_STATE.ACTIVE,
    // Air Itam is a short drive from George Town, so a ride advertised to
    // "Georgetown, Penang" genuinely serves this destination too.
    rideDestinationAliases: ['Georgetown'],
    travelNote: 'In Air Itam, a short drive inland from George Town. There is an inclined lift to the upper terrace if the climb is not for you.',
    reviews: [
      review('Jason Teoh', 5, 'Go late afternoon and stay for the lights. The climb is worth it.'),
      review('Farah Idris', 4, 'Beautiful, but very busy on public holidays. Weekday mornings are calm.')
    ]
  },
  {
    id: 'p_chulia',
    sourcePlaceId: 'fixture_chulia',
    name: 'Chulia Street Night Hawkers',
    category: CATEGORY.CULINARY,
    description: 'A street of after-dark stalls trading duck kway chap, wantan mee and koay teow.',
    descriptionIsTemplate: false,
    rating: 4.2, reviewCount: 3100,
    lat: 5.4165, lng: 100.3357,
    state: 'Penang',
    photoReferences: [photo('chulia-1', 'Ismail Bakar')],
    lifecycleState: PLACE_STATE.ACTIVE,
    // This street is inside George Town, so a ride there serves it directly.
    rideDestinationAliases: ['Georgetown'],
    travelNote: 'In the middle of George Town, so easy to reach on foot. Most stalls open after 7pm and run past midnight.',
    reviews: [
      review('Adeline Kwan', 4, 'Cheaper and less touristy than Gurney. The duck kway chap is the one to get.'),
      review('Vikram Nair', 4, 'Chaotic in a good way. Bring cash and be ready to share a table.')
    ]
  },
  {
    id: 'p_taman_negara',
    sourcePlaceId: 'fixture_taman_negara',
    name: 'Taman Negara Canopy Walkway',
    category: CATEGORY.NATURE,
    description: 'A suspended walkway strung through one of the oldest rainforests on earth.',
    descriptionIsTemplate: false,
    rating: 4.6, reviewCount: 4200,
    lat: 4.3833, lng: 102.4000,
    state: 'Pahang',
    photoReferences: [photo('tamannegara-1', 'Zaharah Omar')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'Around 3.5 hours from Kuala Lumpur, then a boat leg upriver. Most people stay a night rather than attempt it in a day.',
    reviews: [
      review('Nicholas Lai', 5, 'The canopy walk is the headline but the night jungle trek was better.'),
      review('Rohana Ismail', 4, 'Humid and buggy. Bring repellent and accept you will be damp all day.')
    ]
  },
  {
    id: 'p_a_famosa',
    sourcePlaceId: 'fixture_a_famosa',
    name: 'A Famosa and St Paul’s Hill',
    category: CATEGORY.HERITAGE,
    description: 'The surviving gate of a Portuguese fortress, below a ruined hilltop church.',
    descriptionIsTemplate: false,
    rating: 4.1, reviewCount: 11200,
    lat: 2.1919, lng: 102.2501,
    state: 'Melaka',
    photoReferences: [photo('afamosa-1', 'Rohan Menon')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['Melaka Sentral'],
    travelNote: 'Central Melaka, walkable from Jonker Street. Little shade on the hill, so go early or late.',
    reviews: [
      review('Emily Choo', 4, 'Small site, big history. Read the plaques or you will miss the point of it.'),
      review('Hafiz Rahman', 3, 'Very crowded midday. The view from the top is the best part.')
    ]
  },
  {
    id: 'p_christ_church',
    sourcePlaceId: 'fixture_christ_church',
    name: 'Christ Church Melaka',
    category: CATEGORY.HERITAGE,
    description: 'An eighteenth-century Dutch church of handmade brick, still in weekly use.',
    descriptionIsTemplate: false,
    rating: 4.3, reviewCount: 8600,
    lat: 2.1943, lng: 102.2493,
    state: 'Melaka',
    photoReferences: [photo('christchurch-1', 'Sylvia Lim')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'On Dutch Square in central Melaka. Free to enter outside service times; the interior beams are single lengths of timber.',
    reviews: [
      review('Andrew Pang', 4, 'Photographed to death from outside, but almost nobody goes in. Worth stepping inside.'),
      review('Noraini Yaakob', 5, 'The ceiling beams alone are worth the visit.')
    ]
  },
  {
    id: 'p_batu_caves',
    sourcePlaceId: 'fixture_batu_caves',
    name: 'Batu Caves',
    category: CATEGORY.HERITAGE,
    description: 'A limestone cave temple reached by 272 painted steps under a gilded statue.',
    descriptionIsTemplate: false,
    rating: 4.4, reviewCount: 45000,
    lat: 3.2379, lng: 101.6840,
    state: 'Selangor',
    photoReferences: [photo('batucaves-1', 'Kumar Selvam')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['KLCC', 'Kuala Lumpur'],
    travelNote: 'Half an hour north of Kuala Lumpur and on the commuter rail line. Cover shoulders and knees to enter the temple.',
    reviews: [
      review('Deepa Krishnan', 4, 'Go before 8am. By ten it is shoulder to shoulder on the steps.'),
      review('Tom Lau', 4, 'The macaques will take food straight out of your hand. Do not carry it openly.')
    ]
  },
  {
    id: 'p_blue_mosque',
    sourcePlaceId: 'fixture_blue_mosque',
    name: 'Sultan Salahuddin Abdul Aziz Mosque',
    category: CATEGORY.HERITAGE,
    description: 'A blue-domed mosque in Shah Alam with four of the tallest minarets in the region.',
    descriptionIsTemplate: false,
    rating: 4.6, reviewCount: 6200,
    lat: 3.0787, lng: 101.5209,
    state: 'Selangor',
    photoReferences: [photo('bluemosque-1', 'Aisyah Kamarudin')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'In Shah Alam, about 40 minutes from central Kuala Lumpur. Robes are lent at the entrance and guided visits run outside prayer times.',
    reviews: [
      review('Iman Zulkifli', 5, 'Far quieter than Batu Caves and every bit as striking. The guides are generous with their time.'),
      review('Charles Ng', 5, 'Went as a non-Muslim visitor and was made very welcome. Check the visiting hours first.')
    ]
  },
  {
    id: 'p_ipoh_old_town',
    sourcePlaceId: 'fixture_ipoh_old_town',
    name: 'Ipoh Old Town',
    category: CATEGORY.HERITAGE,
    description: 'A grid of tin-boom shophouses now holding white coffee kopitiams and mural lanes.',
    descriptionIsTemplate: false,
    rating: 4.3, reviewCount: 7600,
    lat: 4.5975, lng: 101.0901,
    state: 'Perak',
    photoReferences: [photo('ipoh-1', 'Lee Chee Meng')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'Roughly 2 hours from Kuala Lumpur and on the electric train line. The old town is compact enough to cover on foot in a morning.',
    reviews: [
      review('Serena Yap', 5, 'The kopitiams are the reason to come. Sit in one for an hour and watch the street.'),
      review('Zulkarnain Aziz', 4, 'Quieter than Penang for the same kind of shophouse architecture.')
    ]
  },
  {
    id: 'p_gua_tempurung',
    sourcePlaceId: 'fixture_gua_tempurung',
    name: 'Gua Tempurung',
    category: CATEGORY.NATURE,
    description: 'A limestone cave system with a river passage running through its lower level.',
    descriptionIsTemplate: false,
    rating: 4.4, reviewCount: 2400,
    lat: 4.4147, lng: 101.1836,
    state: 'Perak',
    photoReferences: [photo('guatempurung-1', 'Michael Toh')],
    lifecycleState: PLACE_STATE.ACTIVE,
    travelNote: 'Near Gopeng in Perak, about 2 hours from Kuala Lumpur. The wet route involves wading and crawling; the dry route is a walkway.',
    reviews: [
      review('Preeti Sharma', 5, 'Did the full wet route. Cold, muddy and the best few hours of the trip.'),
      review('Boon Keat Sim', 4, 'The dry route is fine for kids. Bring a torch even though it is lit.')
    ]
  },

  // --- VM2026 event: seasonal alignment scores 1.0 while its window is open.
  {
    id: 'p_vm2026_rainforest',
    sourcePlaceId: 'fixture_vm2026_rainforest',
    name: 'Rainforest World Music Festival',
    category: CATEGORY.EVENT,
    description: 'A three-day festival staged in the grounds of the Sarawak Cultural Village.',
    descriptionIsTemplate: false,
    rating: 4.7, reviewCount: 2890,
    lat: 1.7500, lng: 110.3200,
    state: 'Sarawak',
    photoReferences: [photo('rwmf-1', 'Melissa Anak Jipin'), photo('rwmf-2', 'Joseph Anak Ubang')],
    lifecycleState: PLACE_STATE.ACTIVE,
    // FR-6.24 weights a destination against the travel date, so a registered
    // event carries the dates it actually runs on. A festival in August should
    // not lift a trip planned for March.
    vm2026Event: {
      name: 'Rainforest World Music Festival 2026',
      start: '2026-07-10',
      end: '2026-07-12'
    },
    travelNote: 'Held at the Sarawak Cultural Village near Kuching, about 45 minutes from the city. Tickets and accommodation both sell out well ahead of the festival weekend.',
    reviews: [
      review('Elaine Chong', 5, 'Workshops in the afternoon are the best part and most people skip them for the evening stage.'),
      review('Bilal Zainuddin', 5, 'Rainforest setting makes it. Nothing else in the region sounds or feels like this.'),
      review('Sarah Kupang', 4, 'Muddy if it rains, and it will rain. Wear something you do not mind ruining.')
    ]
  }
];

const defaults = {
  absenceCounter: 0,
  stateBeforeDemotion: null,
  // { name, start, end } for a registered VM2026 event; null where the place is
  // not one. See SeasonalCalendar.resolveSeason().
  vm2026Event: null,
  photoReferences: [],
  rideDestinationAliases: [],
  // A place with too few reviews to summarise also has too few to display - the
  // same thin-data condition FR-6.10 and FR-6.16 both turn on.
  reviews: [],
  travelNote: ''
};

function freshState() {
  return {
    places: seedPlaces.map((p) => ({ ...defaults, ...p })),
    interest: [],        // { userId, placeId, travelDate, createdAt }
    registrations: [],   // { id, userId, placeId, travelDate, status, createdAt }
    preferences: {}      // userId -> { preferredCategories, promptDismissed }
  };
}

function load() {
  if (typeof localStorage === 'undefined') return freshState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    // The catalogue itself is always re-seeded: it is source-derived data, not
    // user data, so a stale copy in a browser must not shadow a newer fixture.
    return { ...parsed, places: freshState().places };
  } catch {
    return freshState();
  }
}

function save(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      interest: state.interest,
      registrations: state.registrations,
      preferences: state.preferences
    }));
  } catch {
    // A full or unavailable localStorage must not break browsing.
  }
}

let state = load();
const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

const fixtureDiscoveryDb = {
  async listPlaces() {
    await delay();
    return state.places.map((p) => ({ ...p }));
  },

  async getPlace(placeId) {
    await delay();
    const found = state.places.find((p) => p.id === placeId);
    return found ? { ...found } : null;
  },

  /**
   * FR-6.30. Unique per (user, place, travel date) - opening the same destination
   * five times is one interested user, not five, which is what makes the demand
   * count meaningful.
   */
  async recordInterest(userId, placeId, travelDate) {
    await delay();
    const exists = state.interest.some(
      (i) => i.userId === userId && i.placeId === placeId && i.travelDate === travelDate
    );
    if (!exists) {
      state.interest.push({ userId, placeId, travelDate, createdAt: new Date().toISOString() });
      save(state);
    }
    return { recorded: !exists };
  },

  /**
   * FR-6.31. Returns counts only, never who - the same privacy boundary the
   * `place_latent_demand()` security definer function enforces in Postgres.
   */
  async latentDemand(travelDate) {
    await delay();
    const counts = new Map();
    for (const row of state.interest) {
      if (row.travelDate !== travelDate) continue;
      const seen = counts.get(row.placeId) || new Set();
      seen.add(row.userId);
      counts.set(row.placeId, seen);
    }
    return new Map([...counts].map(([placeId, users]) => [placeId, users.size]));
  },

  async getPreferences(userId) {
    await delay();
    return state.preferences[userId] || null;
  },

  async savePreferences(userId, { preferredCategories = [], promptDismissed = false } = {}) {
    await delay();
    state.preferences[userId] = { preferredCategories, promptDismissed };
    save(state);
    return { ...state.preferences[userId] };
  },

  /** FR-6.33 / UC6.6 A1: a repeat request returns the existing registration. */
  async registerForNotification(userId, placeId, travelDate) {
    await delay();
    const existing = state.registrations.find(
      (r) => r.userId === userId && r.placeId === placeId
        && r.travelDate === travelDate && r.status === 'active'
    );
    if (existing) return { registration: { ...existing }, alreadyExisted: true };

    const registration = {
      id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId, placeId, travelDate,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    state.registrations.push(registration);
    save(state);
    return { registration: { ...registration }, alreadyExisted: false };
  },

  async listRegistrations(userId) {
    await delay();
    return state.registrations.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  },

  async cancelRegistration(userId, registrationId) {
    await delay();
    const found = state.registrations.find((r) => r.id === registrationId && r.userId === userId);
    if (found) {
      found.status = 'cancelled';
      found.closedAt = new Date().toISOString();
      save(state);
    }
    return found ? { ...found } : null;
  },

  // Test hook: restores the seed so one test's writes cannot leak into another.
  __reset() {
    state = freshState();
    save(state);
  }
};

export const discoveryDb = USE_LIVE_DISCOVERY ? liveDiscoveryDb : fixtureDiscoveryDb;
