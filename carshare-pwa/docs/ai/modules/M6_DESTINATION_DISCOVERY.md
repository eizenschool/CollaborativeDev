# Module 6 — Destination Discovery

## Owner
Brayden Toh Zhi Kang

## Purpose
Answers "where should I go?" for a traveller who has no destination in mind, then
hands them to Module 4 to find a ride or Module 2 to publish one. Maintains a
shared place catalogue without a human maintainer, and ranks destinations by how
well they suit the user and how efficiently they can be reached.

## Scope Change (tutor approved)
This module previously covered Trust & Safety. That scope was redistributed and
**is no longer Module 6's**:

| Went to | Former FRs | Subject |
|---|---|---|
| Module 2 | FR-6.1–6.10, 6.22, 6.32 | PIN, GPS cross-check, confirmations, exchange settlement, disputes |
| Module 3 | FR-6.13, 6.15–6.21, 6.25 | Panic Button, hazard reporting and credibility |
| Module 1 | FR-6.14, 6.24, 6.26–6.31 | Safety Report, Trust Case, enforcement, appeals |
| Module 5 | FR-6.11, 6.12, 6.23 | Trip overdue detection and escalation |

The existing prototype code for that scope stays where it is and now belongs to
its new owners — `src/business-logic/verification/`,
`src/presentation/components/safety/`, `src/data-access/module6Store.js`, the
`/safety` route, and `docs/MODULE6-SCHEMA.md`. Destination Discovery does not
modify any of it.

## Requirement Intent
38 FRs / 14 UCs. Scheduled ingestion of a place catalogue with no manual entry;
enrichment (one category per place, a description derived from that place's own
reviews); two-axis relevance scoring; presentation split between destinations a
ride already serves and destinations no ride serves; recorded interest
aggregated into latent demand; group formation and ride-availability
notification; a place query interface served to Modules 2 and 4.

## Core Design Decisions

**The recommendation unit is the (Place, User, Travel Window) triple**, not the
place. The same place ranks differently for two users on the same day. Place-level
facts are cached between ingestion cycles; the scores are computed per request and
**never cached** — seat availability changes whenever a ride is published or a
seat taken, so a stored ranking would be wrong within minutes.

**Interest and intent are different signals and must not be conflated.**
Interest is registered on selecting a destination to view it — weak, cheap, and
what latent demand counts. Intent is registered on initiating a group trip or
registering for notification — strong, and what converts into a published ride.

**No Admin actor, deliberately.** Every place state transition is driven by the
ingestion cycle or the enrichment pass that follows it. Where enrichment output
fails validation the system substitutes a category template rather than queueing
the record for a person. The catalogue is required to stay current without a
maintainer.

## Load-Bearing Formula

```text
D = 0.30*Affinity + 0.25*Season + 0.20*Quality + 0.15*Headroom + 0.10*Local
A = 0.55*SeatHeadroom + 0.30*JourneyCost + 0.15*DemandConvergence
```

Three behaviours follow from the weighting itself and need no separate rule:

1. **Seat headroom at 0.55 bounds an unserved destination's A at 0.45**, below the
   0.60 primary threshold. Filling an existing empty seat therefore outranks
   creating a new journey as an arithmetic consequence — this is the module's
   central premise and the project's SDG 12 argument. `DestinationScoringEngine.test.js`
   pins it so a weight change cannot quietly break it.
2. **Review confidence is a factor of quality, not a separate gate**, so a place
   rated 5.0 on two reviews (0.20) ranks below 4.3 on eight thousand (0.825). The
   FR-6.16 display suppression and the ranking treatment of thin data are one
   mechanism.
3. **Local economy at 0.10 sits below the 0.15 gap between the two desirability
   thresholds**, so independence can reorder comparable candidates but cannot
   carry a poorly matched one across a presentation boundary.

Do not change these constants casually.

## What Works Today
`/discover` runs end to end with no Google key, no deployed schema, and no
network: recommendations, the two-section presentation, destination detail with
reviews and the score breakdown, first-use preferences, interest recording,
notification registration, the host-facing unmet demand view, and the weather
gate. 380 tests pass and make zero external calls.

Not built yet: scheduled ingestion and enrichment (UC6.8, UC6.9 — needs the API),
Street View (FR-6.15 — needs the API), notification dispatch (UC6.12 — needs
Module 3), and the implementation of the prefill handoff into Modules 2 and 4
(FR-6.35 — its shared contract is accepted, but the form wiring remains).

The accepted FR-6.35 handoff shape is defined in
`docs/ai/FR-6.35_PREFILL_CONTRACT.md` (D019). The contract is shared by Modules
2 and 4; it does not require the Google ingestion API.

## Repository Areas
Business logic: `src/business-logic/discovery/`
- `constants.js` — every weight and threshold in one place
- `DestinationScoringEngine.js` — the two-axis score and presentation rule
- `SeasonalCalendar.js` — FR-6.24 declared windows, wrap-around and leap-day safe
- `PlaceLifecycle.js` — Pending Enrichment → Active/Provisional → Stale → Retired
- `ChainDetection.js` — state-scoped name recurrence
- `AffinityResolver.js` — trip history → stated preference → neutral
- `WeatherGate.js` — UC6.11, pure rules plus a thin Open-Meteo fetcher
- `PlaceQueryService.js` — **the interface Modules 2 and 4 consume**
- `DiscoveryContractAdapter.js` — the only file importing another module
- `DestinationDiscoveryService.js` — orchestration
- `geo.js`, `__tests__/`

Presentation: `src/presentation/components/discover/` — hub, detail, card, rail,
preference prompt, score breakdown, unmet demand view, and `PlacePoster.jsx`
(the FR-6.17 illustration tier).

Data: `src/data-access/discoveryStore.js` (fixture catalogue, own localStorage key).
Schema: `database/sql/024_m6_destination_discovery.sql` (deployed as
`m6_destination_discovery`; live catalogue population remains pending).
API: `docs/MODULE6-API-SETUP.md`.

## Depends On
Module 2 published rides and remaining seats (read-only, for seat headroom);
Module 1 profile region/language (read-only); Module 5 completed trip history
(read-only, for personal affinity); Module 3 for notification dispatch; Google
Places API; a meteorological service for the weather gate.

## Serves
`PlaceQueryService.js` — callable now, against the fixture catalogue, with no key
and no deployment:

- Module 4 FR-4.1/4.2 — `queryPlacesNearPoint({ lat, lng, radiusKm, category })`
- Module 2 FR-2.15/2.16 — `queryPlacesAlongRoute({ origin, destination, corridorWidthKm, category })`

Both return `{ placeId, sourcePlaceId, name, category, lat, lng, state, rating,
reviewCount, photoReference }` and exclude Retired places. The corridor query
orders by position along the route, not by proximity, because a Host wants stops
in the order they will pass them. `places_near_point()` in `024` mirrors the
radius query in SQL for when the catalogue moves to Supabase.

Neither module maintains its own place data; one catalogue serves all three.

## Known Limitation — Google Maps Platform Terms (accepted risk)
Google's terms permit indefinite storage of **place IDs only**. Names, ratings,
review counts, review text, and photographs are to be requested live and shown
with attribution rather than stored. This module caches rating, review_count,
description, and photo references because FR-6.11 forbids enrichment at request
time and the Desirability formula consumes rating and review_count on every
scoring pass.

The team has accepted this for an academic prototype. **It must be stated in the
report's limitations section rather than left unrecorded.** Image bytes are never
copied into project Storage; only photo references are held. Attribution
requirements (author name for photos and reviews, "Google Maps" attribution) still
apply wherever the data is displayed.

## External Requests
Every request this module will make - endpoint, field mask, billing tier, quota,
and the console work still outstanding - is specified in
`docs/MODULE6-API-SETUP.md`. None of it is needed to run, test, or demo the
module today: the screens work offline on the fixture catalogue.

## Cost Boundary
Free monthly caps: Nearby/Text Search 1,000 each, Place Details 1,000, Place
Photos 1,000, Street View Static 10,000, Street View **metadata unlimited** — which
is why FR-6.15 queries metadata before ever requesting an image.

Photos are the only continuing cost: because references rather than bytes are
stored, every view spends a request. Mitigations are lazy-loading only the first
carousel image in list view and long-lived browser cache headers on the proxy.

Ingestion is one-time-ish and bounded: FR-6.6 halts a cycle at its request quota
and resumes at the next scheduled run, so a low daily quota delays catalogue
completion rather than breaking it.

## Open Questions
Server-side API key provisioning (the two existing keys are website-restricted
browser keys and cannot be used from an Edge Function); which SKUs are enabled;
travel window as a single date vs a range; whether the weather gate uses a free
no-key service; Module 3 notification dispatch contract.
