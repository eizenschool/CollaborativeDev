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
| Whole suite | **514 tests / 33 files** — **512 passing.** The 2 failures are a pre-existing regression from Module 2's ride-lifecycle merge (mock ride data no longer has a departure on the date Module 6's tests expect), not caused by this module's own work. Tracked separately, not fixed here — `mockDataStore.js`/`RideService.js` are Module 2's files. |
| Module 6's own | **327 tests / 17 files** (includes the 2 above) |
| Build | passes |
| Backend | **live**, opt-in. With no `.env.local`, everything runs on the 22-place fixture catalogue — still the default, and what the automated suite always uses regardless of `.env.local`. With `.env.local` set (`VITE_SUPABASE_*` + `VITE_DISCOVERY_DATA_SOURCE=supabase`), `/discover` reads a real Supabase catalogue of 20 Kuala Lumpur places with real photos and reviews — see §7 and `docs/MODULE6-API-SETUP.md` §6. |

This file was last brought current after: live ingestion (`docs/MODULE6-API-SETUP.md`
§6), the `categoryFor`/`primaryType` classification fix, live photo rendering
(`PlaceImage.jsx`), review storage and display (`027_m6_place_reviews.sql`,
`reviewHighlight.js`), and anonymous browsing (`029_m6_anon_place_browsing.sql`
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
| `reviewHighlight.js` | Picks the longest stored review as an attributed quote to show alongside `description`. |
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
| 6.8, 6.9, 6.10 — description generation | `description` is a generated single sentence (FR-6.8's "generated" is a template, not free text) | Not derived from review content — an earlier attempt to do that wrote a review's text into `description` verbatim and unattributed, which was reverted (`027`'s header). Real review content is shown separately, attributed, via `reviewHighlight.js` and the full review list |
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
npm test        # 514 tests, zero external calls regardless of .env.local
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
| Review highlight | Any card → an attributed quote below the description; on the detail page it replaces what used to be a static "category template" note |
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
> Verify with `npm test` (514 passing — 2 pre-existing failures are Module 2's,
> tracked separately, not mine to fix) and by actually opening the screens, not
> only by the build succeeding. Confirm whether `.env.local` is present and
> correctly named (`.env.local`, not `env.local`) before assuming fixture vs
> live behaviour either way.
