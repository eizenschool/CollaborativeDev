# Module 6 API Setup — Destination Discovery

Every external request Module 6 makes, what it costs, and what has to exist in
the console before any of it can run. Companion to `docs/GOOGLE-MAPS-SETUP.md`,
which covers Module 2's separate location boundary and is **not** superseded by
this file.

Accepted scope is D018 in `docs/ai/DECISIONS.md`.

**Status: ingestion is live.** `024_m6_destination_discovery.sql` is deployed;
`GOOGLE_PLACES_SERVER_KEY` is set and working; `m6-ingest` has run twice against
Kuala Lumpur and populated `places` with 20 real destinations, each carrying
real photos and up to five stored, attributed reviews (`027_m6_place_reviews.sql`).
`anon` read access is deployed and confirmed working
(`029_m6_anon_place_browsing.sql` + `030_m6_anon_source_place_id.sql`), so a
signed-out visitor sees real recommendations too.

None of this is required for the offline build, tests, or demo - the fixture
catalogue (`src/data-access/discoveryStore.js`) is still the default, selected
by leaving `VITE_DISCOVERY_DATA_SOURCE` unset. The live adapter
(`src/data-access/discoverySupabaseRepository.js`) is opt-in, and the test
suite always uses the fixture regardless of `.env.local` - see the guard in
`discoveryStore.js`.

---

## 1. What has to exist before any request runs

| Item | State | Who |
|---|---|---|
| Places API (New) enabled in `my-project-cd-505310` | Already enabled for Module 2 | done |
| **Server-side API key** (see §2) | **Created and working** | done |
| Nearby Search authorised on that key | **Confirmed working** (used every ingestion run) | done |
| Place Details authorised on that key | **Confirmed working** (35 calls across two runs) | done |
| Place Photos authorised on that key | **Confirmed working** - the browser key, not the server one, serves photos live; see §3.3 | done |
| Street View Static authorised on that key | Unused by the implementation that shipped - see §3.4. The image renders from the browser (same pattern as Place Photos), so it needs a browser-restricted key, not the server one this row refers to; the server key's Street View authorisation can stay or be removed, it does nothing either way. Code is done and waiting on a **new browser-restricted key**, `lets-tumpang-web-streetview` | Brayden |
| Per-service daily hard quotas (§5) | **Unconfirmed** - console state not verified against the four application budget targets; no database-enforced ledger exists yet either | Brayden |
| `024_m6_destination_discovery.sql` deployed | **Deployed** as `m6_destination_discovery` | done |
| `027_m6_place_reviews.sql` deployed | **Deployed** through the Dashboard SQL Editor; adds `places.reviews` | done |
| `029_m6_anon_place_browsing.sql` + `030_m6_anon_source_place_id.sql` deployed | **Deployed and confirmed working** - `029` alone broke anonymous browsing entirely (excluded `source_place_id`, and one ungranted column denies the whole shared query, not just that field); `030` fixed it | done |
| `supabase/functions/m6-ingest/index.ts` deployed | **Deployed and active** as `m6-ingest`; has ingested real data twice | done |
| `GOOGLE_PLACES_SERVER_KEY` set as a Supabase secret | **Done** | done |

## 2. The key: why the two existing ones cannot be reused

`GOOGLE-MAPS-SETUP.md` provisions two **browser** keys restricted by HTTP
referrer. Module 6's ingestion is a scheduled server-side job with no browser and
no referrer header, so a referrer-restricted key is rejected on every call.

A third key is required:

```text
Name:        lets-tumpang-server-ingestion
Application restriction: None, or IP addresses if the Edge Function egress IPs are known
API restriction:         Places API (New) + Street View Static API only
Stored as:               Supabase secret GOOGLE_PLACES_SERVER_KEY
```

**It must never carry a `VITE_` prefix.** Vite inlines every `VITE_*` variable
into the client bundle, which would publish a key that has no referrer
restriction to protect it.

## 3. The requests

All Places calls use Places API (New). Every request **must** send an
`X-Goog-FieldMask` header; the API rejects requests without one.

### 3.1 Catalogue sweep — FR-6.1, FR-6.2, FR-6.6

```http
POST https://places.googleapis.com/v1/places:searchNearby
X-Goog-Api-Key: {GOOGLE_PLACES_SERVER_KEY}
X-Goog-FieldMask: places.id,places.types,places.location,places.photos

{
  "includedTypes": ["restaurant", "tourist_attraction", "museum", "park"],
  "maxResultCount": 20,
  "locationRestriction": {
    "circle": { "center": { "latitude": 3.139, "longitude": 101.6869 },
                "radius": 50000.0 }
  }
}
```

Run once per configured region per cycle. `places.id` is the upsert key for
FR-6.2 and the only field the Maps terms permit storing indefinitely.

Field mask is deliberately Essentials-only — see §4.

### 3.2 Enrichment — FR-6.7, FR-6.8, FR-6.10, FR-6.12, FR-6.16

```http
GET https://places.googleapis.com/v1/places/{PLACE_ID}
X-Goog-Api-Key: {GOOGLE_PLACES_SERVER_KEY}
X-Goog-FieldMask: displayName,rating,userRatingCount,reviews,photos,types,primaryType,location
```

One request per place, on first ingestion or detected source change only.
FR-6.11 forbids running this at request time, which is also what keeps it
affordable: it is a per-place one-off, not a per-page-view cost. `primaryType`
is free to add: `reviews` already puts this request at Enterprise + Atmosphere,
the field mask's highest tier, and `primaryType` sits at or below that.

Maps to the module as follows:

| Response field | Used by |
|---|---|
| `primaryType` | FR-6.7 classification, checked first - Google's own single classification, more reliable than scanning the unordered `types` bag (see the traps note on `tourist_attraction`) |
| `types` | FR-6.7 classification fallback when `primaryType` does not match a known type |
| `reviews[].text` | Stored with author attribution as `places.reviews` (`027`) and shown on the detail page as attributed reviews. Also the source `PlaceDescription.js` describes a place from - but only through phrases two or more reviewers used independently, never by quoting one; see `027`'s header for what happened when a single review was written into `description` verbatim |
| `rating`, `userRatingCount` | Desirability quality and headroom signals; FR-6.16 rating suppression |
| `photos[].name` | FR-6.13 carousel references; FR-6.12 Provisional when absent |
| `location` | Journey-cost signal, FR-6.36/6.37 spatial queries |

### 3.3 Photographs — FR-6.13, FR-6.14

```http
GET https://places.googleapis.com/v1/{PHOTO_NAME}/media?maxHeightPx=800&skipHttpRedirect=true
X-Goog-Api-Key: {GOOGLE_PLACES_SERVER_KEY}
```

`PHOTO_NAME` is the stored `photos[].name` from §3.2.

This is the **only continuing cost in the module**. Image bytes may not be copied
into project storage, so each viewing spends a request. Three mitigations, all
already reflected in the UI:

- the list renders one photograph per card, not the whole carousel;
- the carousel loads a frame only when it is shown;
- responses are proxied with a long `Cache-Control`, so a repeat view is served
  by the browser rather than by Google.

`authorAttributions` from §3.2 must be displayed wherever a photograph is shown
(FR-6.14), along with the "Google Maps" attribution the policy requires.

### 3.4 Street View — FR-6.15

```http
GET https://maps.googleapis.com/maps/api/streetview/metadata?location={LAT},{LNG}&key={KEY}
```

Free and unmetered. Only when it returns `"status": "OK"`:

```http
GET https://maps.googleapis.com/maps/api/streetview?location={LAT},{LNG}&size=600x400&key={KEY}
```

FR-6.15's metadata-first rule exists precisely because the check costs nothing
while the image does. Where coverage is absent the module falls to the category
illustration (FR-6.17), which is already implemented in `PlacePoster.jsx`.

**Code status (2026-08-17): implemented, blocked only on a key.** The client
side is done: `src/business-logic/discovery/StreetView.js` builds both URLs and
runs the metadata-first check, mirroring `WeatherGate.js`'s fetch-boundary split
so the decision logic is unit-testable with zero network access
(`StreetView.test.js`, 17 tests). `PlaceImage.jsx` wires it in as the middle
tier between a real Google Photo and the illustration - deferred behind an
`IntersectionObserver` so a scrolled-past card never fires the metadata check,
the same cost discipline `loading="lazy"` already gives photos. With no key
configured, `hasStreetViewKey()` is false and nothing else in the module ever
runs; confirmed live in the browser, zero requests to any `streetview` endpoint.

**This cannot reuse Module 2's browser key.** `docs/GOOGLE-MAPS-SETUP.md`
explicitly disables Street View on `VITE_GOOGLE_MAPS_PLACES_API_KEY`: "Static
Maps, Dynamic Maps, Street View, and other unused APIs remain disabled." That
is Module 2's accepted cost boundary, not an oversight, and widening it without
Yee's sign-off is exactly the kind of unilateral cross-module change AGENTS.md
rules out. Module 6's photo pipeline already reuses that key for Places Photos
(a Places API (New) endpoint the key does authorise); Street View is a separate
legacy Maps Platform API and needs its own key.

**What is still needed, and it is entirely console work:**

```text
Name:        lets-tumpang-web-streetview
Application restriction: Websites
  http://localhost:5173/*
  the final HTTPS deployment domain, once known
API restriction: Street View Static API only
Env var:     VITE_GOOGLE_STREETVIEW_API_KEY (new - not the server key, not M2's key)
```

Once the key exists and is set, no further code changes are needed. Same
budget discipline as the rest of this module: free monthly cap is 10,000
Street View Static requests and unlimited metadata (§5); the application
budget target from that table is 50 image requests/day, which the
metadata-first check protects.

### 3.5 Weather — FR-6.22, FR-6.23, FR-6.38

```http
GET https://api.open-meteo.com/v1/forecast
      ?latitude={LAT}&longitude={LNG}
      &daily=weather_code&start_date={DATE}&end_date={DATE}
      &timezone=Asia%2FKuala_Lumpur
```

**Already implemented and needs nothing from anyone** — see
`src/business-logic/discovery/WeatherGate.js`. Open-Meteo is free, requires no
key, and is therefore outside the Google cost boundary entirely. FR-6.38's
requirement that the credential never reach the client holds trivially because
there is no credential.

Requested only for outdoor-category candidates, since an indoor destination
cannot be withheld on weather.

---

## 4. The field mask is the bill

Places API (New) charges **the highest tier present in the request**, so one
Enterprise field in an otherwise cheap request prices the whole call at
Enterprise.

| Field | Tier |
|---|---|
| `id`, `name`, `photos` | Essentials (IDs Only) |
| `location`, `types`, `formattedAddress` | Essentials |
| `displayName` | Pro |
| `rating`, `userRatingCount` | **Enterprise** |
| `reviews` | **Enterprise + Atmosphere** |

This is why §3.1 and §3.2 are separate calls rather than one. The sweep touches
every place in every cycle and stays on the Essentials mask; the expensive
Enterprise + Atmosphere mask is paid once per place, at enrichment, and never
again unless the source changes.

Merging them into a single "just fetch everything" call would reprice the entire
recurring sweep at the most expensive tier for no functional gain.

## 5. Quotas and budget boundaries before enabling

Free monthly caps, per the pricing table current at the time of writing:

| SKU | Free per month |
|---|---|
| Nearby Search | 1,000 |
| Text Search | 1,000 |
| Place Details | 1,000 |
| Place Details Photos | 1,000 |
| Street View Static | 10,000 |
| Street View metadata | unlimited |
| Maps Embed | unlimited |

The Google Cloud console does **not** necessarily show one quota row per billing
SKU. Open **Google Maps Platform → Quotas** (direct link:
`https://console.cloud.google.com/project/_/google/maps-apis/quotas?project=my-project-cd-505310`),
choose the project, then choose **Places API** from the API selector. Places API
(New) limits are normally shown per API method and per minute; search the table
for the relevant method or request quota, select its checkbox, choose the
three-dot menu, and choose **Edit quota**. Place Photos is part of Places API
(New), not a separate Google Cloud API to select.

If the page exposes a daily request row, the following are our application
budget targets, following the D013 precedent that a hard quota — not an alert —
is the spending boundary:

```text
Nearby Search          30 / day
Place Details          50 / day
Place Details Photos  200 / day
Street View Static     50 / day
```

A low quota does not break ingestion. The ingestion function caps each run with
`maxResultCount` and `maxDetails`. A persistent per-day ledger still needs to be
added before these numbers can be described as a true daily server-side cap;
until then, do not assume that a Google console per-minute limit is equivalent
to the four application budgets above.

Disable automatic quota increases. Set 50/75/90% alerts, and treat them as
notifications rather than as a stop.

## 6. Invoking the deployed ingestion function

`m6-ingest` is a service-to-service function. It uses Supabase's `secret` auth
mode and expects the Supabase secret key in the `apikey` header, not as a
`Bearer` token. The platform JWT check is disabled for this function because
modern `sb_secret_...` keys are not JWTs; the function's Supabase auth wrapper
validates the key before the handler runs.

Run one small test only after setting `GOOGLE_PLACES_SERVER_KEY`:

```powershell
$headers = @{
  apikey = $env:SUPABASE_SECRET_KEY
  'Content-Type' = 'application/json'
}
$body = @{
  regions = @(@{
    id = 'kl-smoke'
    state = 'Kuala Lumpur'
    latitude = 3.139
    longitude = 101.6869
    radiusMeters = 5000
  })
  maxResultCount = 5
  maxDetails = 1
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri 'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m6-ingest' `
  -Headers $headers `
  -Body $body
```

Keep `$env:SUPABASE_SECRET_KEY` in the current terminal only; never commit it
or place it in a Vite `VITE_` variable. The response should report one
`upserted` place. Confirm the row in the Dashboard Table Editor before turning
on `VITE_DISCOVERY_DATA_SOURCE=supabase` locally.

**`refreshDetails: true`** re-enriches places the catalogue already knows,
instead of the default behaviour of only touching (`markSeen`, free) a known
place and spending Place Details only on genuinely new ones. It costs one
Details call per place in the batch, same as first enrichment, so use it only
when something about how existing places are enriched has changed - it was
added specifically to backfill `places.reviews` (`027`) onto rows ingested
before that column existed, without deleting and re-ingesting them, which
would have cascaded away their recorded `place_interest` rows.

```powershell
$body = @{
  regions = @(@{ id = 'kl'; state = 'Kuala Lumpur'; latitude = 3.139; longitude = 101.6869; radiusMeters = 50000 })
  maxResultCount = 20
  maxDetails = 20
  refreshDetails = $true   # omit for normal ingestion of new places only
} | ConvertTo-Json -Depth 5
```

**Ingestion log, Kuala Lumpur:**

| Run | `maxDetails` | `refreshDetails` | discovered | enriched | refreshed | upserted |
|---|---|---|---|---|---|---|
| First pass | 20 | — | 20 | 15 | 5 | 15 |
| Refresh pass (to backfill `reviews`) | 20 | true | 20 | 20 | 0 | 20 |

`failures` was empty on both runs. Total real cost: 2 Nearby Search calls (one
free `maxDetails: 0` reconnaissance call before the first pass, one live) plus
35 Place Details calls across both passes. Category classification was wrong
on the first pass (`nature` and `event` both came back empty - `categoryFor`
checked a fixed order and `tourist_attraction`, sitting in the `heritage`
bucket, matched almost everything); this was fixed in code and the 6 affected
rows were corrected with a direct `PATCH` rather than a third ingestion run.
Live category distribution after both fixes: culinary 8, heritage 6, nature 5,
event 1.

**Ingestion log, Penang / Melaka / Selangor (2026-08-16):**

| Run | region | `maxDetails` | discovered | enriched | refreshed | skipped | upserted |
|---|---|---|---|---|---|---|---|
| Recon (`dryRun`) | each of three | 0 | 20 each | 0 | 0 | — | 0 |
| Main | Penang | 20 | 20 | 20 | 0 | — | 20 |
| Main | Melaka | 20 | 20 | 20 | 0 | — | 20 |
| Main | Selangor | 20 | 20 | 20 | 0 | — | 20 |
| Nature top-up (canary) | Penang | 2 | 20 | 2 | 1 | 0 | 2 |
| Nature top-up | Penang | 20 | 20 | 16 | 3 | **1** | 16 |

Cost: **6 Nearby Search + 79 Place Details**. `failures` was empty on every run.

Two things this log records that the Kuala Lumpur one could not. First, the
three main runs were issued **separately, one region each**, because
`maxDetails` is a per-*run* budget shared across regions (`index.ts`), so three
regions in one call with `maxDetails: 50` would have silently dropped ten
places from whichever region the loop reached last. Second, the nature top-up
used a nature-only `includedTypes` list, because the default four types let
restaurants take 8-11 of every 20 slots and Penang came back with **zero**
nature places on the main run — Penang Hill, the national park and the botanical
gardens were never discovered at all, let alone misclassified.

Ten of the sixty main-run rows were classified wrongly and were corrected by
`032_m6_reclassify_ingested_places.sql` — four hotels, a shopping mall and a
columbarium retired, four real destinations recategorised. The classification
rules themselves are fixed in `classification.ts`; the nature top-up ran against
the fixed function and correctly refused `MBI Desaku Homestay`, which the old
rules would have filed as a destination. Live distribution after all of it:
92 recommendable rows — Kuala Lumpur 20, Penang 37, Melaka 20, Selangor 15.

**Backfill (same day, after both were fixed).** `refreshDetails: true` across
all five sweeps, to re-read every row against the corrected rules and to
populate `types`, `primary_type` and the real `state` on rows ingested before
those existed. Cost: **9 further Nearby Search and roughly 145 Place Details**,
including two small 150-metre probe sweeps used to read the live type bags of
two places the rules had turned away.

Three things the backfill established that no amount of local testing had:

- `Cheong Fatt Tze - The Blue Mansion` returns `hotel, lodging, restaurant,
  food, point_of_interest, establishment` — **no heritage signal at all**, a
  type bag structurally identical to the De Palma Hotel's. The rule written to
  keep it could never have worked; its test had been written against an invented
  bag. `resolveCategory` now lets the rules decide new places only, and a known
  place the rules cannot classify keeps the category the catalogue holds.
- Retained places keep their **lifecycle state** as well as their category.
  Without that, the refresh would have restored all four retired hotels and the
  columbarium, because the upsert picks Active or Provisional from review and
  photo counts and every one of them has plenty of both. Verified after the run:
  all six still withheld.
- `The TOP Penang`'s primaryType is `amusement_center`, a value the event list
  did not hold, so even after the ordering fix it was resolving by the weaker
  signal. Added.

Repeating the sweeps also grew the catalogue from 92 to **109** recommendable
rows, because Google's Nearby ranking is not identical between calls. The state
fix showed itself here: the new arrivals resolved to **Kedah** (4) and
**Negeri Sembilan** (2) rather than being absorbed into the sweeping region's
state. Live distribution: Penang 43, Melaka 21, Kuala Lumpur 20, Selangor 19,
Kedah 4, Negeri Sembilan 2.

**Known and not fixed:** `Tropical Spice Garden | Events Venue | Cooking
Classes | Spice Store` classifies as `event` rather than `nature` — its Google
listing name advertises an events venue and it carries `event_venue` to match.
Arguable either way and left alone.

## 7. Terms of service — accepted risk

Google permits indefinite storage of **place IDs only**. Names, ratings, review
counts, review text and photographs are to be requested live and displayed with
attribution rather than warehoused.

This module caches rating, review count, the generated description, photo
references, and (since `027_m6_place_reviews.sql`) up to five reviews per
place, because FR-6.11 forbids enrichment at request time and the Desirability
formula consumes rating and review count on every scoring pass.

The team accepted this for an academic prototype. It is recorded here, in
D018, in `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`, in the header of
`database/sql/024_m6_destination_discovery.sql`, and in `027`'s own header, and
**must appear in the report's limitations section**. Image bytes are never
copied into project storage; only references are held. Every stored review
carries its author, and the detail screen displays that author, so the
attribution requirement is met even though the caching one is not - see `027`'s
header for the mistake this replaced (a review written into `description`
itself, unattributed).

## 8. Expanding beyond Kuala Lumpur

The Kuala Lumpur region is ingested (§6's log). Before adding another region -
Penang, Melaka, or any other - repeat the same discipline `GOOGLE-MAPS-SETUP.md`
sets for Module 2, this time against a real batch rather than a throwaway
smoke test:

1. Record Nearby Search, Place Details and Photos usage before starting.
2. Run a free reconnaissance call first (`maxDetails: 0, dryRun: true`) to see
   how many candidates the region holds before spending anything on Details.
3. Run the ingestion cycle for that region.
4. Confirm the counters moved only for the expected SKUs, and that Place Details
   was billed at the tier the field mask implies.
5. Confirm no request was made from the browser bundle — all Places traffic must
   originate from the Edge Function.
6. Check `categoryFor`'s output against the real result the way §6 records for
   Kuala Lumpur - `primaryType` fixed the systematic heritage-swallows-everything
   failure, but a region with an unfamiliar mix of place types is still worth a
   manual spot check before trusting the distribution.
7. Do not repeat ingestion to exercise UI states. Automated tests mock every
   external call and must continue to make zero real requests.
