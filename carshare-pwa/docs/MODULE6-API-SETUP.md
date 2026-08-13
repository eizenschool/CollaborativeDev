# Module 6 API Setup — Destination Discovery

Every external request Module 6 makes, what it costs, and what has to exist in
the console before any of it can run. Companion to `docs/GOOGLE-MAPS-SETUP.md`,
which covers Module 2's separate location boundary and is **not** superseded by
this file.

Accepted scope is D018 in `docs/ai/DECISIONS.md`.

**Status: none of this is live.** The module runs entirely on the local fixture
catalogue (`src/data-access/discoveryStore.js`) and works offline. Nothing below
is required for the current build, tests, or demo.

---

## 1. What has to exist before any request runs

| Item | State | Who |
|---|---|---|
| Places API (New) enabled in `my-project-cd-505310` | Already enabled for Module 2 | done |
| **Server-side API key** (see §2) | **Not created** | Brayden |
| Nearby Search authorised on that key | Not done | Brayden |
| Place Details authorised on that key | Not done | Brayden |
| Place Photos authorised on that key | Not done | Brayden |
| Street View Static authorised on that key | Not done, optional | Brayden |
| Per-service daily hard quotas (§5) | Not done | Brayden |
| `024_m6_destination_discovery.sql` deployed | Not deployed | Brayden |
| `GOOGLE_PLACES_SERVER_KEY` set as a Supabase secret | Not done | Brayden |

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
X-Goog-FieldMask: displayName,rating,userRatingCount,reviews,photos,types,location
```

One request per place, on first ingestion or detected source change only.
FR-6.11 forbids running this at request time, which is also what keeps it
affordable: it is a per-place one-off, not a per-page-view cost.

Maps to the module as follows:

| Response field | Used by |
|---|---|
| `types` | FR-6.7 classification into culinary/heritage/nature/event |
| `reviews[].text` | FR-6.8 single-sentence description; FR-6.10 withholds generation below three |
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

## 5. Quotas to set before enabling

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

Suggested daily hard quotas, following the D013 precedent that a hard quota — not
an alert — is the spending boundary:

```text
Nearby Search          30 / day
Place Details          50 / day
Place Details Photos  200 / day
Street View Static     50 / day
```

A low quota does not break ingestion. FR-6.6 halts a cycle when it reaches its
request budget and resumes at the next scheduled run, so a 200-place catalogue
simply fills over several days instead of failing.

Disable automatic quota increases. Set 50/75/90% alerts, and treat them as
notifications rather than as a stop.

## 6. Terms of service — accepted risk

Google permits indefinite storage of **place IDs only**. Names, ratings, review
counts, review text and photographs are to be requested live and displayed with
attribution rather than warehoused.

This module caches rating, review count, the generated description and photo
references, because FR-6.11 forbids enrichment at request time and the
Desirability formula consumes rating and review count on every scoring pass.

The team accepted this for an academic prototype. It is recorded here, in
D018, in `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`, and in the header of
`database/sql/024_m6_destination_discovery.sql`, and **must appear in the
report's limitations section**. Image bytes are never copied into project
storage; only references are held.

## 7. Controlled smoke test

Run only once the hard quotas are visible in the console, following the same
discipline `GOOGLE-MAPS-SETUP.md` sets for Module 2:

1. Record Nearby Search, Place Details and Photos usage before starting.
2. Run one ingestion cycle against a single small region.
3. Confirm the counters moved only for the expected SKUs, and that Place Details
   was billed at the tier the field mask implies.
4. Confirm no request was made from the browser bundle — all Places traffic must
   originate from the Edge Function.
5. Do not repeat the smoke test to exercise UI states. Automated tests mock every
   external call and must continue to make zero real requests.
