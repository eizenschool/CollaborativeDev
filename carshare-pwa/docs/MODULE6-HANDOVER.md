# Module 6 Handover — Destination Discovery

Everything needed to pick this module up cold: what it is, what is built, why it
is built that way, what must not be touched, and what is still outstanding.

Written 2026-08-14 against `Module6_Trust_And_Safety` @ `53d9a61`. Updated
2026-08-15 after live ingestion, anonymous browsing, and description/review
work landed.

Owner: **Brayden Toh Zhi Kang** (QA Lead).

---

## 1. Start here

If you are a fresh session, read in this order:

1. This file — the module's current state and history.
2. `AGENTS.md` — project working rules (commit format, branch policy, layering).
3. `docs/ai/modules/M6_DESTINATION_DISCOVERY.md` — compact module context.
4. `docs/MODULE6-API-SETUP.md` — every external request, only when doing API work.
5. `docs/ai/SQL.md` — before touching the database.

Run the app: `npm install && npm run dev`, then open `/discover`.
Run the tests: `npm test`.

### Current state, verified

| | |
|---|---|
| Branch | `Module6_Trust_And_Safety`, synced with `Development` |
| Whole suite | **552 tests / 34 files** — all passing **only with `.env.local` parked**; see the environment table below, this is not the same claim as it used to be |
| Module 6's own | **365 tests / 18 files** |
| Build | passes |
| Backend | **live**, opt-in. With no `.env.local`, everything runs on the 22-place fixture catalogue — still the default, and what the automated suite always uses regardless of `.env.local`. With `.env.local` set (`VITE_SUPABASE_*` + `VITE_DISCOVERY_DATA_SOURCE=supabase`), `/discover` reads a real Supabase catalogue of **92 places across Kuala Lumpur, Penang, Melaka and Selangor** with real photos and reviews — see §7 and `docs/MODULE6-API-SETUP.md` §6. |

### Environment on Brayden's machine — read before running anything

| | |
|---|---|
| `carshare-pwa/.env.local` | **Exists and is correctly named.** It carries `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, two Google browser keys, and `VITE_DISCOVERY_DATA_SOURCE=supabase`, so `npm run dev` runs against the **live** catalogue. Park it (`mv .env.local .env.local.parked`) to demo or debug the fixture path. It was once named `env.local` without the leading dot, which Vite silently ignores — see §10. |
| `npm test` | **Park `.env.local` before running it.** This row used to claim the suite was unaffected either way. That is false and was measured false on 2026-08-16: with `.env.local` present, 19 tests fail — 16 in Module 5's `TripHistoryEngine.test.js` and 3 ride-related ones in this module's `DestinationDiscoveryService.test.js`. `discoveryStore.js`'s `MODE === 'test'` guard only protects this module's own catalogue; the **ride lookup has no such guard**, so `isSupabaseConfigured` sends it at the live backend. `mv .env.local .env.local.parked`, run, move it back — 552/552 pass. The real fix belongs in Module 5's file and is **Tang's**, not this module's; it is the one live hole in the "tests make zero real API calls" rule. |
| `SUPABASE_SECRET_KEY` | Set as a **Windows user environment variable** so ingestion could be invoked without the key passing through a file or a chat message. It bypasses every RLS policy. **Clear it when ingestion work is done:** `setx SUPABASE_SECRET_KEY ""` |
| Dev server port | `npm run dev` walks up from 5173 when ports are busy. Read the actual port from its output rather than assuming 5173. |
| Worktrees | Only the main checkout matters. Two empty `.claude/worktrees/` folders may linger from finished sessions; git no longer tracks them and they can be deleted whenever the shells holding them close. |

This file was last brought current after: live ingestion (`docs/MODULE6-API-SETUP.md`
§6), the `categoryFor`/`primaryType` classification fix, live photo rendering
(`PlaceImage.jsx`), review storage and display (`027_m6_place_reviews.sql`,
`PlaceDescription.js`), and anonymous browsing (`029_m6_anon_place_browsing.sql`
+ `030_m6_anon_source_place_id.sql`, both run and **confirmed working live** —
signed-out `/home` and `/discover` show real recommendations, verified against
the actual REST responses and in the browser, not just by reading the SQL).

---

## 2. What this module is

Module 6 was **Trust & Safety**. With tutor approval that scope was redistributed
to Modules 1/2/3/5, and Module 6 became **Destination Discovery** — 38 FRs,
14 UCs. See §6 for the handover of the old scope.

It answers *"where should I go?"* for a traveller with no destination in mind,
then hands them to Module 4 to find a ride or Module 2 to publish one.

**The recommendation unit is the `(Place, User, Travel Window)` triple**, not the
place. The same place ranks differently for two users on the same day. Place-level
facts are cached between ingestion cycles; the scores are computed per request and
**never cached** — seat availability changes whenever a ride is published or a
seat is taken, so a stored ranking would be wrong within minutes.

**Interest and intent are different signals and must not be conflated.** Interest
is recorded when a destination is selected — weak, cheap, and what latent demand
counts. Intent is recorded on initiating a group trip or registering for
notification — strong, and what converts into a published ride.

**There is deliberately no Admin actor.** Every place state transition is driven
by the ingestion cycle or the enrichment pass after it. The catalogue is required
to stay current without a maintainer.

### The two scores

```text
D = 0.30*Affinity + 0.25*Season + 0.20*Quality + 0.15*Headroom + 0.10*Local
A = 0.55*SeatHeadroom + 0.30*JourneyCost + 0.15*DemandConvergence
```

Presentation rule, on the (D, A) pair:

| Condition | Section |
|---|---|
| A ≥ 0.60 and D ≥ 0.50 | primary list |
| A ≥ 0.60 and D < 0.50 | primary list, below the desirable ones |
| A < 0.60 and D ≥ 0.70 | unserved section, with the group-formation prompt |
| A < 0.60 and D < 0.70 | withheld from the default view |

### Three load-bearing properties — do not change these constants casually

1. **Seat headroom at 0.55 caps an unserved destination's A at 0.45**, below the
   0.60 primary threshold. "Filling an existing empty seat beats creating a new
   journey" is therefore an arithmetic consequence, not an appended rule. This is
   the project's SDG 12 argument and `DestinationScoringEngine.test.js` pins it so
   a weight change cannot quietly break it.
2. **Review confidence is a factor of quality, not a separate gate**, so 5.0 on
   two reviews (0.20) ranks below 4.3 on eight thousand (0.825). FR-6.16's display
   suppression and the ranking treatment of thin data are one mechanism.
3. **Local economy at 0.10 sits below the 0.15 gap between the two desirability
   thresholds**, so independence can reorder comparable candidates but cannot
   carry a poorly matched one across a presentation boundary.

You can watch property 1 working: the top pick is usually **Kek Lok Si**, not the
far more famous **George Town**, because George Town is the most-reviewed heritage
site in Penang and scores 0 on visitation headroom.

---

## 3. File inventory

### Business logic — `src/business-logic/discovery/`

| File | Purpose |
|---|---|
| `constants.js` | Every weight and threshold in one place. BVA tests import from here rather than hardcoding literals. |
| `DestinationScoringEngine.js` | The two scores, the presentation rule, `rankCandidates()`. Pure. |
| `SeasonalCalendar.js` | FR-6.24. Declared windows as data; wrap-around and leap-day safe. |
| `PlaceLifecycle.js` | Pending Enrichment → Active/Provisional → Stale → Retired, and restoration. |
| `ChainDetection.js` | FR-6.26, state-scoped name recurrence. |
| `AffinityResolver.js` | FR-6.20 fallback: trip history → stated preference → neutral. |
| `WeatherGate.js` | UC6.11. Pure rules plus a thin batched Open-Meteo fetcher. |
| `RecommendationReasons.js` | Turns signals into sentences, ranked by contribution. |
| `PlaceQueryService.js` | **The interface Modules 2 and 4 consume.** |
| `DiscoveryContractAdapter.js` | **The only file importing another module.** Read-only. |
| `DestinationDiscoveryService.js` | Orchestration. No arithmetic lives here. |
| `DiscoveryDemoControls.js` | Weather override and month shortcuts for demonstrations. |
| `localDate.js` | Today's date read from local `Date` getters, not `toISOString()`'s UTC one — see §10. |
| `placePhotos.js` | Builds the live Places Photo URL from a stored reference; returns `null` for a fixture placeholder or unconfigured key. |
| `PlaceDescription.js` | FR-6.8/6.9/6.10. Describes a place from phrases two or more of its reviewers used independently. Quotes nobody. |
| `geo.js` | Haversine distance. |

### Presentation — `src/presentation/components/discover/`

`DiscoverRoutes` (sub-router) · `DiscoverHub` (UC6.1) · `DestinationDetail` (UC6.2)
· `DestinationCard` · `UnmetDemandView` (UC6.7) · `DiscoverRail` (home screen)
· `ScoreBreakdown` · `PreferencePrompt` (UC6.4) · `AudienceSwitch` · `DemoControls`
· `PlacePoster` (FR-6.17 illustration tier, fallback) · `PlaceImage` (live photo,
falling back to `PlacePoster` when nothing is fetchable)

Styles: `src/presentation/styles/discover.css`, every rule namespaced `.dsc-*`.

### Data and schema

- `src/data-access/discoveryStore.js` — fixture catalogue, own localStorage key
  `letstumpang_discovery_v1`. 22 real Malaysian places, built so every rule fires
  visibly (see §7). Still the default, and the only source the test suite ever
  reads regardless of `.env.local`.
- `src/data-access/discoverySupabaseRepository.js` — the live adapter. Opt-in via
  `VITE_DISCOVERY_DATA_SOURCE=supabase`.
- `database/sql/024_m6_destination_discovery.sql` — **deployed** as the Supabase
  migration `m6_destination_discovery`.
- `database/sql/027_m6_place_reviews.sql` — **deployed** (Dashboard SQL Editor);
  adds `places.reviews`.
- `database/sql/029_m6_anon_place_browsing.sql` and
  `030_m6_anon_source_place_id.sql` — **deployed** (Dashboard SQL Editor) and
  confirmed working: signed-out `/home` and `/discover` show real
  recommendations. `030` fixed a genuine live break `029` caused on its own —
  see the new trap in §10 before writing another anon grant.

### Docs

`docs/MODULE6-API-SETUP.md` (every external request) ·
`docs/ai/modules/M6_DESTINATION_DISCOVERY.md` (module context) ·
`docs/ai/modules/TRUST_SAFETY_HANDOVER.md` (the old scope) ·
`docs/MODULE6-SCHEMA.md` (**superseded**, describes the old scope)

---

## 4. Boundaries — read before editing anything

**Never touch.** These belong to Module 2 now (see §6):

```text
src/business-logic/verification/**
src/presentation/components/safety/**
src/data-access/module6Store.js
the /safety route in App.jsx
```

**Never edit another module's context file** — `docs/ai/modules/M1..M5_*.md` are
maintained by their owners.

**Shared files this module is allowed to touch, and why:**

| File | Change | Owner |
|---|---|---|
| `src/App.jsx` | one import, one `/discover/*` route | shared |
| `src/presentation/components/HomeScreen.jsx` | one import, one `<DiscoverRail />` | shared |
| `src/presentation/components/ride/RideHub.jsx` | optional search prefill params; a link to the demand view | **Yee (M2)** |
| `src/presentation/components/ride/PublishRide.jsx` | optional destination prefill param | **Yee (M2)** |
| `docs/ai/*` | TODO, DECISIONS (D018), FILEMAP, SQL, PROJECT, AGENTS module name | shared |

⚠️ **Yee has not been told about the last two.** Both are purely additive and
behave exactly as before when no parameter is present — verified by opening
`/ride` with none — but he should know. There was no way to deliver FR-6.35
without them: a prefill needs a receiver.

---

## 5. FR coverage

**Implemented and tested**

FR-6.3, 6.4, 6.5, 6.12 (lifecycle) · 6.13, 6.14 (carousel, attribution) · 6.16
(rating suppression) · 6.17 (illustration) · 6.18, 6.19 (scoring, presentation) ·
6.20, 6.21 (affinity, preferences) · 6.22, 6.23 (weather gate) · 6.24 (seasonal) ·
6.25, 6.26 (chain detection) · 6.27, 6.28, 6.29 (seats from Module 2) · 6.30, 6.31
(interest, latent demand) · 6.32 (group trip initiation) · 6.34 (unmet demand) ·
6.35 (prefill) · 6.36, 6.37 (queries for M4 and M2) · 6.38 (weather service)

**Implemented, with a real caveat**

| FRs | What works | What is still missing |
|---|---|---|
| 6.1, 6.2, 6.6 — catalogue sweep and ingestion | `m6-ingest` runs against Google Places and has populated 20 real places (`docs/MODULE6-API-SETUP.md` §6) | **Not scheduled.** Every run so far has been triggered manually; there is no cron and no automatic recurring sweep |
| 6.7 — classification | `categoryFor` uses Google's `primaryType` first, falling back to a scan of `types` — see the trap this replaced in §10 | — |
| 6.8, 6.9, 6.10 — description generation | `PlaceDescription.js` composes four sentences per place from data already stored: what kind of place it is, what several reviewers independently single out, its rating, and its distance. `DESCRIPTION_MIN_REVIEWS` withholds generation below three reviews (FR-6.10) and `description_is_template` (FR-6.9) keeps a hand-authored sentence rather than overwriting it | Composed at read time rather than written into `places.description`, so the stored column is still the category template. Regenerating wording therefore needs no re-ingestion, but anything reading the database directly still sees the template |
| 6.11 — enrichment-not-at-request-time | Holds: ingestion runs offline, scoring never calls Google | — |

**Not implemented, and why**

| FRs | Blocked on |
|---|---|
| 6.15 — Street View | Google API; not exercised even though the server key could support it |
| 6.33 — notification dispatch | Module 3's notification pipeline; the registration and matching side is built |

UC6.7 (unmet demand) and UC6.14 (serve place data) are complete. UC6.8, UC6.9,
UC6.12, UC6.13 are not.

---

## 6. The old Trust & Safety scope

Redistributed with tutor approval. The prototype code stays where it is under its
new owners; **Destination Discovery does not modify any of it.**

| Owner | Former FRs | Code |
|---|---|---|
| Module 2 — Yee Zu Yao | 6.1–6.10, 6.22, 6.32 | implemented and tested |
| Module 3 — Chong Zheng Zhe | 6.13, 6.15–6.21, 6.25 | not implemented |
| Module 1 — Daniel Lim | 6.14, 6.24, 6.26–6.31 | not implemented |
| Module 5 — Tang Zheng Shian | 6.11, 6.12, 6.23 | not implemented |

Full detail: `docs/ai/modules/TRUST_SAFETY_HANDOVER.md`.

Note the FR numbers above are the **old** Module 6 numbering and collide with the
new one. "FR-6.24" in this document means seasonal weighting; in the handover
record it means Safety Report review.

---

## 7. Running and demonstrating it

```bash
npm run dev     # then /discover
npm test        # 533 tests, zero external calls regardless of .env.local
```

Entry points: home screen rail → `/discover`; audience switch → `/discover/demand`;
`Ride → My rides → Hosting` → `/discover/demand`.

**Fixture vs live.** With no `.env.local`, the app runs entirely offline on the
fixture catalogue described below — this is what `npm test` always exercises,
and what a fresh checkout demos out of the box. With `.env.local` set
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
`VITE_DISCOVERY_DATA_SOURCE=supabase`), `/discover` reads the live Supabase
catalogue instead: 20 real Kuala Lumpur places with real photos and reviews.
A signed-out visitor can browse the live catalogue too - confirmed live in
the browser and against the raw REST responses, not just by reading the SQL.

### Demonstration controls

`/discover?demo=1` reveals month shortcuts and a weather override. Invisible
otherwise. The override changes what the forecast *says*, never what the gate does
with it — `applyWeatherGate` cannot tell a simulated forecast from a real one, so
what is demonstrated is the real rule. A banner appears on every screen while a
simulation runs.

Without it the weather gate cannot be shown at all: FR-6.22's withholding path
only fires under a severe warning, which Malaysian weather will not supply on
demand.

### What to show, and where each rule is visible

| Rule | How to see it |
|---|---|
| Anti-overtourism | Top pick is Kek Lok Si, not George Town — George Town scores 0 headroom |
| Seasonal weighting | `?demo=1` → Dec: east-coast places drop to 0.30 "North-east monsoon"; Jul: highland peak |
| Weather gate | `?demo=1` → Severe: list drops from 5 cards to 2, "6 outdoor destinations are hidden" |
| Thin data (FR-6.16) | Warung Mak Cik Zainab: 5.0 stars on 2 reviews → "Too few reviews", not 5.0 |
| Chain detection | Three Restoran Sri Nirwana outlets score 0.00 on "Independently run" |
| Retired withholding | Closed Tin Mining Museum appears in no list |
| Reasons, not maths | Any detail page → sentences first, "See how this was scored" collapsed |
| Prefill | Detail → "Find a ride" carries from/to/date into the search form |
| Real photos (live mode) | Any card → a real Google photo, not the generated illustration — falls back to the illustration if the reference is a fixture placeholder or the photo fails to load |
| Description from reviews | Any card → four sentences naming what this place actually is, e.g. KL Tower's "Observation Deck, Sky Box and views from the top". Each phrase was used by two or more reviewers independently; none is a quote |
| Below-threshold places, category or all | `/discover` → any category button, or `All` → the toggle under the two main sections → cards below the recommendation thresholds |
| Anonymous browsing (live mode) | Sign out → `/home` and `/discover` still show real recommendations, scored with neutral affinity |

The fixture catalogue is built to make each of these fire — the chain outlets, the
two-review stall, the Stale and Retired places all exist for that reason.

---

## 8. Outstanding — human actions, not code

1. ~~**Google Cloud** (Brayden). A **server-side** key is required...~~ **Done.**
   The key exists, is stored as `GOOGLE_PLACES_SERVER_KEY`, and has ingested real
   data (`docs/MODULE6-API-SETUP.md` §6). Street View is authorised but not
   exercised. Whether true daily hard quotas are set in the console is
   unconfirmed either way — no database-enforced ledger exists yet, so treat the
   budget as manually tracked, not automatically capped.
2. ~~**Deploy `024_m6_destination_discovery.sql`**~~ **Done**, plus `027`
   (reviews column), `029`, and `030` (anon browsing - both run and confirmed
   working live).
3. **Tell Yee** about the two files in §4. Still open.
4. ~~**Run `029_m6_anon_place_browsing.sql`**~~ **Done.** `029` alone was not
   enough - it excluded `source_place_id` from the anon grant, and because
   `discoverySupabaseRepository.js` selects one fixed column list for every
   caller, that took down anonymous browsing entirely (`permission denied for
   table places`) rather than just omitting one field. `030` fixed it. See the
   trap in §10 before writing another anon column grant for this table.

---

## 9. Accepted risk — must appear in the report

Google Maps Platform terms permit indefinite storage of **place IDs only**. Names,
ratings, review counts, review text and photographs are to be requested live and
displayed with attribution rather than stored.

This module caches rating, review count, description, photo references, and
(since `027_m6_place_reviews.sql`) up to five reviews per place, because
FR-6.11 forbids enrichment at request time and the Desirability formula
consumes rating and review count on every scoring pass.

The team accepted this for an academic prototype. It is recorded in D018, in the
module context file, in the header of `024_m6_destination_discovery.sql`, and in
`027`'s own header, and **must appear in the report's limitations section**.
Image bytes are never copied into project storage; only references are held.
Every stored review carries its author, and the detail screen and card
highlight both display that author, so the attribution requirement is met even
though the caching one is not.

A second cost note: Places API (New) charges at the **highest tier present in a
request**, so `rating` (Enterprise) or `reviews` (Enterprise + Atmosphere) reprice
the whole call. The catalogue sweep and the enrichment pass are separate requests
for exactly this reason.

---

## 10. Traps already hit — do not rediscover these

**Seasonal windows that wrap the year.** November→February contains December and
January; `start <= date <= end` reports the opposite. `SeasonalCalendar.js` handles
it and the tests pin it.

**The leap day.** The monsoon window ends on 29 February deliberately — it does not
stop early because February is short.

**Timezones in date parsing.** `new Date('2026-11-01')` parses as UTC midnight and
reports the previous day west of Greenwich, shifting every seasonal boundary.
`SeasonalCalendar.js` constructs no Date object at all; it reads month and day from
the ISO string.

**`height` on a `<span>` does nothing.** Cards are `<button>` elements, which may
not contain block children, so their interiors are spans — and inline spans ignore
height. The desktop hero rendered 728px instead of 320px because the SVG sized
itself by aspect ratio. Every such container declares its own `display`.

**Tests that pass against nothing.** Module 2's mock store reads `localStorage`
unguarded, so under Node the ride lookup threw, the adapter's catch turned it into
"no rides", and every assertion about the served list passed vacuously against an
empty array. `DestinationDiscoveryService.test.js` shims localStorage and carries a
guard test that fails loudly if the ride lookup ever returns nothing again.

**Sleeping fixtures make flaky suites.** The store slept 200ms per call regardless
of environment; twenty test files sleeping in parallel pushed individual tests past
Vitest's timeout. The delay exists so GUI loading states are visible, so it is zero
under test.

**One weather request per place.** Open-Meteo accepts comma-separated coordinates.
Fetching individually cost 24 requests and 6.4 seconds before the home screen could
paint; batched it is one request and 0.2 seconds.

**Relative signals phrased as absolute claims.** Journey cost is measured against
the furthest candidate, so a 296km trip scores well — but "only 296 km" claims
something the signal never measured. Absolute phrasing is reserved for distances
short by any reading.

**A comment describing behaviour that never happens.** `applyWeatherGate` downgrades
severe to advisory for indoor places, but `fetchForecasts` never requests a forecast
for a place that cannot be withheld on weather, so indoor candidates always carry
UNKNOWN. The branch is correct if data is supplied; the comment now says when that
is.

**`env.local` is not `.env.local`.** Vite loads `.env`, `.env.local`,
`.env.[mode]`, `.env.[mode].local` — never a file missing its leading dot. A
copy that lost the dot along the way silently ran the app on fixtures while
looking, from the filename, like it should have been live. If `/discover`
shows fixture places when live data is expected, check the filename first.

**The live adapter is a deployment choice, not a test fixture.** `discoveryStore.js`
picks `liveDiscoveryDb` purely from `VITE_DISCOVERY_DATA_SOURCE`, which Vitest
reads exactly like any other Vite consumer. A working `.env.local` therefore
pointed the whole discovery test suite at Supabase: 30 of 36 service tests
failed against the fixture-only helpers the live adapter refuses to implement,
and the rest would have made real network calls. Excluded with `import.meta.env?.MODE
!== 'test'`, the same way this file already excludes the simulated latency —
see `discoveryStore.js`'s `USE_LIVE_DISCOVERY`.

**A fixed classification order lets one generic type swallow everything.**
`categoryFor` scanned culinary → heritage → nature → event and returned the
first category holding any of a place's Google types.
`tourist_attraction` sat in the `heritage` list, and nearly every landmark,
park, and theme park Google returns carries it — so live ingestion put KLCC
Park, the botanical gardens, the bird park, and a theme park all in `heritage`,
leaving `nature` and `event` at zero. Fixed by checking Google's own
`primaryType` first and treating generic types (`tourist_attraction`,
`point_of_interest`, `establishment`) as the fallback of last resort, never the
first match.

**A review is not a description, even when it's the only text available.**
`descriptionFor` used to write the first Google review straight into
`places.description`, unattributed, presented as though the application had
written it — and the "sentence" extraction only collapsed whitespace, so the
whole review became the description. Live descriptions read "Awesome and
amazing and better than expectation!!!" for Central Market before this was
caught. Reviews are now stored separately (`027`) with their authors and
shown as reviews; `description` went back to a neutral generated sentence.

**A fixture date that was in the future when it was written stops being in the
future.** `DestinationDiscoveryService.test.js` pins `RIDE_DATE = '2026-08-15'`,
chosen on 2026-08-06 because the shared mock ride data has a departure that
day. Module 2's `mockDataStore.js` runs `processDueRides()` against the **real
wall clock** on every read, flipping a Published ride out of Published once its
departure passes - and the only ride matching that date, `r_1` to Georgetown,
leaves at 07:00. So at 07:00 on 2026-08-15 the file began failing, with no
commit having changed anything: the suite passed all morning and broke in the
evening. It was misdiagnosed twice as a regression from Module 2's
ride-lifecycle merge; the merge did touch `departureAt` in that file, but only
the business rules around it (the publish window went from 5 hours to 1), never
a seeded date. The fix is `vi.useFakeTimers` + `vi.setSystemTime` pinned to a
moment on `RIDE_DATE` before that departure, so the fixture holds whenever the
suite runs. Moving `RIDE_DATE` forward would only reset the timer on the same
bug, and cannot work anyway: one test needs `r_1` specifically, as the only
Georgetown-bound ride. The guard test described below is what caught it.

**Keyword matching without word boundaries.** `PlaceDescription.js` recognises
what kind of place something is by looking for nouns like `park`, `fort` and
`hill`. Matched with `String.includes`, "comfortable" contains `fort`, and two
Kuala Lumpur restaurants were described as forts on the live catalogue;
`parking` would likewise make anywhere a park, and `chill` a hill. It matches
on `\bnoun s?\b` now, and the tests pin the comfortable/fort case specifically.

**Single words are not themes.** The first version of the review-theme
extraction allowed one-word phrases and produced "around", "area", "back",
"helpful" - words that pass every stoplist because they are neither praise nor
stopwords, and which beat good phrases on frequency because a common word
appears in more reviews than a specific one does. Requiring two words fixed
what no amount of blocklisting would have: "Art Deco", "fountain show",
"Petronas Twin Towers" survive it and the noise does not. Related: a shorter
phrase is always at least as frequent as the longer phrase containing it, so
ranking by frequency alone kept "Art" over "Art Deco" - the longer phrase has
to win by rule, not by score.

**A classification fix applied to one branch is not applied to the other.**
The `primaryType`-first fix above was written for the Kuala Lumpur failure and
applied to the `primaryType` branch only. The `types` fallback underneath it
kept the original fixed order with culinary ahead of heritage, so when Penang
was ingested, Cheong Fatt Tze - The Blue Mansion — a UNESCO heritage house with
a restaurant in it — came back culinary, and the detail screen rendered the
badge "Culinary" directly above the place's own generated description, "A museum
in Penang." The same function's final line returned `event` for anything it
could not recognise, which made that category a dumping ground: four hotels and
a shopping mall were offered as answers to "where should I go?". Both are fixed
in `classification.ts`, and the rule is now that what a place *is* outranks what
it merely contains — culinary is last in every fallback order.

**Logic that cannot be imported cannot be tested.** The classification above
lived inside `supabase/functions/m6-ingest/index.ts`, whose first lines import
`jsr:` and `npm:` specifiers that no Vitest run can resolve. So the one piece of
this module that had already caused a catalogue-wide failure was also the only
piece with no test able to reach it — and it regressed. It is now
`classification.ts`, which imports nothing, so Deno bundles it and Node runs it;
`vitest.config.js` has a fourth `include` entry for its tests. Anything else
that moves into an Edge Function needs the same treatment before it is trusted.

**`state` is copied from the region config, not read from the place.**
Ingestion writes `item.region.state` onto every row it creates, so a place is
labelled with whichever region's sweep happened to find it. A 50 km radius from
George Town reaches well into Kedah, so `Dataran Kulim`, `Kulim Bird Park` and
`Tupah Recreational Forest` are all stored as Penang. This is not only a display
error: ChainDetection (FR-6.26) scopes name recurrence **by state**, so a wrong
state silently changes which places are compared against each other. Fixing it
means reading `addressComponents` from the enrichment response — a Pro-tier
field, and therefore free to add to a mask already at Enterprise + Atmosphere.
Not yet done.

**One ungranted column blocks the whole query for every caller sharing that
select list.** `029` granted `anon` a column-restricted read on `places` that
deliberately excluded `source_place_id`. `discoverySupabaseRepository.js`
uses one fixed `PLACE_SELECT` list regardless of who is asking — it has no
branch for auth state — so the moment that list included one column `anon`
lacked, Postgres denied the *entire* query (`permission denied for table
places`), not just that field. Confirmed live: every anonymous `/discover`
and Home-rail read failed until `030` added the missing grant. A
column-restricted grant is only safe for a shared adapter if the select list
either matches the narrowest role reading it, or is deliberately different
per role — mixing "narrow grant" with "one select list for everyone" breaks
the wider role's access, not just the narrower one's.

---

## 11. Starter prompt for a new session

> I am Brayden, owner of Module 6 (Destination Discovery) in the Let's Tumpang
> carshare PWA. Read `carshare-pwa/docs/MODULE6-HANDOVER.md` first, then
> `carshare-pwa/AGENTS.md`. My branch is `Module6_Trust_And_Safety`.
>
> Rules that matter: never touch `src/business-logic/verification/`,
> `src/presentation/components/safety/`, or `src/data-access/module6Store.js` —
> they belong to Module 2 now. Never commit directly to `Development`. Commit
> messages use `[Module6] …` and must not credit any AI as author or co-author.
> Tests must make zero real API calls, regardless of what `.env.local` contains.
>
> Verify with `npm test` (533 passing, all green) and by actually opening the
> screens, not only by the build succeeding. `.env.local` exists and points the
> app at live Supabase; park it to see the fixture path. Read §1's environment
> table before running anything.
>
> Work in the main checkout at `CollaborativeDev`, not in a `.claude/worktrees`
> copy — an earlier session verified against a stale worktree for a full round
> and saw none of its own changes.

### What a new session most likely picks up next

Nothing is half-finished; the module is in a coherent, pushed, all-green state.
The open work, in rough order of value:

1. **Ingest beyond Kuala Lumpur.** One region is loaded (20 places).
   `docs/MODULE6-API-SETUP.md` §8 has the procedure and the cost discipline;
   §6 has the log of what the two Kuala Lumpur runs actually cost.
2. **Publish live rides.** The Home rail and the primary list stay thin because
   accessibility is 55% seat headroom and the live `rides` table has nothing
   going to these places. This is the single biggest visible gap, and it is
   Module 2 data rather than Module 6 code.
3. **Tell Yee** about the two Module 2 files this module touches (§4, item 3 of
   §8) — still genuinely open.
4. **FR-6.15 Street View** and **FR-6.33 notification dispatch** remain
   unimplemented; the latter waits on Module 3.
5. **Scheduled ingestion.** Every run so far has been triggered by hand. FR-6.1
   describes a recurring sweep and there is no cron.
