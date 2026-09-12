# Module 6 complete test procedure

Updated: 2026-09-12

This is the final acceptance procedure for Destination Discovery, Tumpang Guide,
ride-alert hand-offs and the Module 2/4/5 read-only integrations. It tests both
the newly refined journey and the behaviour that existed before it.

The procedure deliberately separates three kinds of evidence:

1. **Automated fixture evidence** proves deterministic application behaviour
   without calling paid APIs.
2. **Manual fixture evidence** proves that a person can understand and complete
   the journey in the rendered UI.
3. **Deployed-environment evidence** proves Supabase, Google, weather and AI
   integrations. A local fixture pass must never be reported as proof of these
   external services.

The submitted report is not changed by this document. Record post-report
improvements as implementation refinements during the presentation.

## 1. Release decision

A build is ready for the presentation only when:

- every P0 case passes;
- no P1 case has an unexplained failure;
- the full unit, layer, build and Playwright commands exit successfully;
- the main journey is checked manually on phone, tablet and desktop;
- no screen claims that a listed ride guarantees a usable pickup, route or seat;
- no network failure is displayed as zero destinations or zero rides;
- live external checks are labelled `PASS`, `FAIL` or `NOT VERIFIED` rather
  than inferred from fixture results.

Use this result vocabulary throughout:

- `PASS` — observed result matches the expected result.
- `FAIL` — observed result differs; record screenshot, URL, time and console/log.
- `BLOCKED` — the test could not run; record the exact dependency.
- `NOT VERIFIED` — external service was intentionally not tested.
- `N/A` — the case does not apply to this build, with a reason.

## 2. Test environments

### 2.1 Deterministic fixture environment

From `carshare-pwa`:

```powershell
npm install
npm run dev:fixture -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/home`. Fixture mode starts as Jamie Delacroix.
When a sign-in test is needed, use:

- Email: `jamie@letstumpang.app`
- Password: `fixture-pass`

Use a clean Chromium profile. Keep DevTools Console and Network available. Do
not enable production Supabase or AI environment variables for fixture tests.

To reset all browser fixture state, paste this into DevTools Console:

```js
localStorage.clear();
sessionStorage.clear();
location.assign('/home?date=2026-09-14');
```

Wait for the reload before continuing. Reset before each group unless the case
explicitly checks persistence.

### 2.2 Deployed environment

Use the actual presentation URL in a separate clean browser profile. Record:

- frontend deployment identifier or commit;
- `m6-tumpang-guide` Edge Function version;
- relevant migration status;
- browser, operating system and device;
- local time and network type;
- whether Gemini, Groq, Google Places and Open-Meteo were available.

Never put provider keys in screenshots or the browser console.

### 2.3 Required viewport matrix

| Code | Viewport | Purpose |
| --- | --- | --- |
| V1 | 375 × 812 | phone and bottom navigation |
| V2 | 768 × 1024 | portrait tablet |
| V3 | 1024 × 768 | landscape tablet / narrow desktop |
| V4 | 1440 × 1024 | presentation desktop |

Run every P0 case on V1 and V4. Run the complete layout group on all four.

## 3. Automated release gate

Run these commands from `carshare-pwa` in this order:

```powershell
npm test -- --reporter=dot
npm run check:layers
npm run build
npx playwright test
```

If Chromium is not installed:

```powershell
npx playwright install chromium
```

Current verified baseline on 2026-09-12:

- Vitest: 129 files, 1,429 tests passed.
- Layer boundaries and local import cycles: passed.
- Production/PWA build: passed.
- Playwright: 175 passed, 29 intentionally skipped.

Also run the two Module 6 browser suites alone when diagnosing a failure:

```powershell
npx playwright test tests/e2e/ui-usability.spec.js tests/e2e/tumpang-guide.spec.js
```

Do not update screenshot baselines merely to remove a failure. Inspect the
actual image first; update only when the visual change is approved.

## 4. Required route inventory

Every route below must load directly after a refresh, not only through in-app
navigation.

| Route | Expected purpose |
| --- | --- |
| `/home?date=2026-09-14` | Explore home with explicit date |
| `/discover` | Redirect to `/home`, preserving the query string |
| `/discover/p_georgetown?date=2026-09-14` | Destination detail with no ride on selected date |
| `/discover/p_georgetown?date=2026-09-15` | Destination detail with seeded ride after setup |
| `/discover/demand?date=2026-09-14` | Host view of browsing interest without available seats |
| `/assistant` | Tumpang Guide |
| `/assistant/history` | Past Plans for a signed-in user |
| `/assistant/session/:sessionId` | Restored Guide session |
| `/assistant/qa` | Guide Q&A/support route |
| `/search?...` | Module 4 hand-off from a destination |
| `/ride/publish?...` | Module 2 publish hand-off |
| `/auth` | guest sign-in return flow |

For an unknown destination, `/discover/not-a-real-place?date=2026-09-14` must
show a recoverable not-found result and must not crash or loop.

## 5. Deterministic fixture state recipes

These recipes are for the local fixture only. Run them in DevTools Console and
allow the final navigation to reload the page.

### F1 — guest in Penang

```js
const fixtureDb = JSON.parse(localStorage.getItem('letstumpang_mock_db_v1'));
fixtureDb.currentUserId = null;
localStorage.setItem('letstumpang_mock_db_v1', JSON.stringify(fixtureDb));
sessionStorage.setItem('m6-exploration:origin', JSON.stringify({
  label: 'George Town, Penang',
  lat: 5.4141,
  lng: 100.3288,
  placeId: 'guest-origin'
}));
location.assign('/home?date=2026-09-14');
```

### F2 — one browsing-interest record, no ride on that date

```js
localStorage.setItem('letstumpang_discovery_v1', JSON.stringify({
  interest: [{
    userId: 'u_demo_1',
    placeId: 'p_georgetown',
    travelDate: '2026-09-14',
    createdAt: new Date().toISOString()
  }],
  registrations: [],
  preferences: {}
}));
location.assign('/discover/p_georgetown?date=2026-09-14');
```

### F3 — one listed ride with three available seats

```js
const fixtureDb = JSON.parse(localStorage.getItem('letstumpang_mock_db_v1'));
Object.assign(fixtureDb.rides.r_1, {
  date: '2026-09-15',
  time: '07:00',
  departureAt: '2026-09-14T23:00:00.000Z',
  status: 'Published',
  expiredAt: null,
  seatsTotal: 3,
  seatsAvailable: 3
});
localStorage.setItem('letstumpang_mock_db_v1', JSON.stringify(fixtureDb));
location.assign('/discover/p_georgetown?date=2026-09-15');
```

### F4 — listed ride with no seats remaining

Run F3, but set `seatsAvailable: 0`, then reload the same detail route.

### F5 — existing unsent Guide draft

Open `/assistant`, complete onboarding, type `Keep my original idea` but do not
send it. Return to a destination detail and choose **Ask Tumpang Guide**. This
must expose the keep/replace decision without deleting the draft.

## 6. Manual acceptance journey

Record one screenshot for each P0 case and record the final URL for every
cross-module hand-off.

### A. App shell and compatibility

#### M6-A01 — default and legacy entry routes — P0

1. Reset fixture state.
2. Open `/` and confirm it reaches `/home`.
3. Open `/discover?date=2026-09-14&category=nature&q=park`.
4. Confirm it redirects to `/home` and preserves `date`, `category` and `q`.
5. Refresh the resulting URL.

Expected: page loads without a blank screen, redirect loop or lost query.
Navigation, Profile, Search, Ride, Trips and Message remain reachable.

#### M6-A02 — member header — P0

Open `/home?date=2026-09-14` after reset.

Expected: eyebrow says `Hi, Jamie`; the main title and existing layout are
unchanged. It must not replace the member greeting with `Starting from ...`.

#### M6-A03 — console and network hygiene — P0

Navigate Home → detail → Search → back → Guide → Home.

Expected: no uncaught error, failed React render, repeated request loop, secret
key, raw prompt, account ID or exact coordinates appear in browser logs.

### B. Starting point and journey context

#### M6-B01 — guest starting point — P0

Apply F1.

Expected: eyebrow says `Starting from George Town, Penang`. The starting-point
summary names the same origin. No text claims the origin is Kuala Lumpur.

#### M6-B02 — manual origin change — P0

1. On Home, activate the starting-point summary.
2. Search and select a confirmed place different from Kuala Lumpur.
3. Note the distance on one destination card.
4. Open that destination.

Expected: dialog is usable; selected origin appears on Home; cards are
recalculated; detail uses the same origin and distance. Distance is described as
straight-line, never road distance or driving time.

#### M6-B03 — device location success — P1, deployed environment

Grant browser location permission, choose **Use my location**, and wait for the
operation to finish.

Expected: a resolved place/address is shown rather than the literal `Current
location`; confirmed coordinates remain private to the tab and are not added to
the URL.

#### M6-B04 — device location denied or unavailable — P0

Deny location permission and choose **Use my location**.

Expected: the previous origin remains selected, an understandable failure is
shown, manual place selection remains available, and destination browsing is
not blocked.

#### M6-B05 — tab lifetime and new tab fallback — P1

1. Change origin and refresh the same tab.
2. Open the same Home URL in a genuinely new tab/session.

Expected: same-tab refresh keeps the origin. A new tab without stored origin
uses and labels the Kuala Lumpur default. Exact coordinates never appear in a
shareable URL.

### C. Date, search and current-interest preference

#### M6-C01 — explicit date remains fixed — P0

Open `/home?date=2026-09-14`, a fixture date with no George Town ride.

Expected: date remains `2026-09-14`; the page does not silently jump to
`2026-09-15` or any date with a ride.

#### M6-C02 — initial date rules — P1

1. Open Home with a valid URL date.
2. Open Home without a date.
3. Open Home with an invalid date string.

Expected: valid date is used; missing/invalid date uses the browser's Malaysia
local date. No ride date is selected automatically.

#### M6-C03 — alternative date is opt-in — P0

Use F3, then return to `/home?date=2026-09-14`.

Expected: an alternative future date is offered only for a visible matching
destination. The selected date changes only after clicking the offered date.

#### M6-C04 — filters apply to every section — P0

1. Select each category in turn.
2. Search by a known place name, state and category word.
3. Inspect Best matches, More places to explore and any revealed lower section.

Expected: every visible card satisfies both current search and category.
Nothing outside the filter is inserted merely to fill the screen.

#### M6-C05 — empty result recovery — P0

Enter a unique impossible query such as `zz-no-such-place`.

Expected: `No destinations match these filters` and **Clear filters** appear.
Choosing it restores results and removes `q` and `category` from the URL while
preserving the date.

#### M6-C06 — explicit interest outranks history only for this request — P0

1. As Jamie, note the All ordering.
2. Select **Nature**.
3. Refresh and inspect the URL.
4. Return to **All**.

Expected: Nature filters and prioritises the current request even if history
favours food. The selection is in the URL, not automatically saved as a
long-term preference. All restores the existing history → saved preference →
neutral path. Formula weights and thresholds remain unchanged.

### D. Cards and transport-state truthfulness

#### M6-D01 — ride with seats — P0

Apply F3 and inspect the detail and corresponding Home card.

Expected: `1 listed ride` and `up to 3 seats in one listed ride`. It must not
present three as a total across all rides or promise the pickup suits the user.

#### M6-D02 — listed ride with no seats — P0

Apply F4.

Expected: ride count remains visible and the state says `No seats remaining`.
It must not become `No listed ride`.

#### M6-D03 — no ride plus browsing interest — P0

Apply F2.

Expected: both `No listed ride for this date` and `1 traveller has viewed this
as an option for this date` appear as separate facts. Interest must not replace
the transport state or imply a booking or commitment.

#### M6-D04 — undated detail — P1

Open `/discover/p_georgetown` after F3.

Expected: wording uses `upcoming listed ride`; it does not pretend that an
undated request is for today.

#### M6-D05 — ride read unavailable — P0, automated plus deployed fault test

In the deployed test profile, block only the Supabase ride-search request (for
example the `rest/v1/rides` request) while allowing the places catalogue to
load. Refresh Home and detail.

Expected: destinations remain visible; transport says `Ride information is
temporarily unavailable`; it explicitly says this does not mean zero rides.
Interest remains separate. Remove the block and use retry/refresh to recover.

#### M6-D06 — neutral section meaning — P0

Inspect cards under **More places to explore**.

Expected: each card carries its own transport state. Section position must not
be described as proof that nobody is driving there.

### E. Destination detail and scoring

#### M6-E01 — list/detail continuity — P0

Set origin, date, query and category, scroll down, open a result and return.

Expected: same destination, date, origin and distance appear on detail. Back
restores the full Home URL and approximately the previous scroll position.

#### M6-E02 — decision information — P1

Expected on a normal detail: official name, state, category, rating/review
coverage, description, available travel note and straight-line distance are
readable. Missing data is omitted or labelled; it is never invented as live
hours, prices, traffic, crowd level, return transport or safety assurance.

#### M6-E03 — scoring explanation — P0

Choose **See how this was scored**.

Expected labels include:

- `Lower review coverage than comparable places`
- `Available seats in one listed ride`
- `Relative straight-line proximity`
- `Browsing interest for this date`

Accessibility explanation names listed rides, relative straight-line proximity
and browsing interest, and says pickup suitability still needs checking. No
copy says `already on the road`, `on the way`, `easy to reach`, `quiet` or
`crowded` as a conclusion from these signals.

#### M6-E04 — no-ride score cap — P0

Expand scoring on a no-ride result.

Expected: cap explanation says no matching listed ride exists for the selected
date. Formula values, weights, thresholds and ordering match the submitted
formula tests.

#### M6-E05 — loading, not found and retry — P0

1. Reload detail under Slow 3G.
2. Open the unknown-place route from section 4.
3. Block the places request, refresh, then remove the block and retry.

Expected: loading reaches completion or a terminal failure; unknown place has a
safe way back; catalogue failure is not shown as a missing place and can recover.

#### M6-E06 — optional interest failure — P1

Block only the `place_interest` write, then open a destination from Home.

Expected: detail still opens, no infinite retry occurs and no false success is
shown. Opening the same destination repeatedly creates at most one interest row
for the same user/place/date when writes work.

### F. Find a ride, publish and notification hand-offs

#### M6-F01 — search scope and pickup boundary — P0

1. Open `/discover/p_georgetown?date=2026-09-14`.
2. Before clicking, confirm the 10 km scope note is visible.
3. Choose **Find a ride**.

Expected URL contains:

- `destination=George Town Heritage Core`
- `date=2026-09-14`
- `destinationPlaceId=fixture_georgetown`
- `proximityKm=10`

Expected: `pickup` is absent and the Pickup field is empty. The traveller must
confirm pickup, time and seat suitability in Module 4. Zero results do not
remove or broaden the selected date automatically.

#### M6-F02 — served ride search — P0

Apply F3 and choose **Find a ride** from the 2026-09-15 detail.

Expected: date and destination context survive. Search may include rides ending
within 10 km, but does not describe them as guaranteed matches for the user's
pickup or party.

#### M6-F03 — publish hand-off — P1

On a no-ride detail choose **I will drive**.

Expected: `/ride/publish` receives destination and selected date. It does not
publish automatically and does not pre-confirm a pickup point.

#### M6-F04 — guest notification and sign-in return — P0

1. Sign out while retaining `/discover/p_georgetown?date=2026-09-14`.
2. Choose **Tell me when there is a ride**.
3. Sign in with the fixture account.

Expected: auth explains why sign-in is needed and returns to the same place and
date. Registration is not executed automatically; the user must choose the
action again.

#### M6-F05 — register, duplicate and cancel — P0

1. Register the alert while signed in.
2. Refresh the detail.
3. Confirm the button shows the active state.
4. Cancel it and refresh again.

Expected: destination and date are named; one active registration exists;
repeated clicks do not create duplicates; cancellation is visible. Copy states
that an alert is not a booking and does not guarantee a driver.

#### M6-F06 — notification failure recovery — P0, deployed fault test

Block the alert insert/delete request, then attempt registration and cancellation.

Expected: previous action state is preserved, failure is visible and retry is
possible. No false active/cancelled state appears.

### G. Tumpang Guide complete flow

#### M6-G01 — entry, onboarding and controls — P0

Open `/assistant` from Home.

Expected: onboarding is understandable and dismissible; New chat, Past Plans,
Travel Brief, composer, voice-language selector, microphone and send controls
remain keyboard reachable. No control overlaps the navigation or composer.

#### M6-G02 — Travel Brief and current location — P0

Open Travel Brief; set confirmed origin, date, party and category. Test location
success and denial as in B03/B04.

Expected: summary updates, Save preferences retains its existing confirmation
rules, and no budget question or budget field appears.

#### M6-G03 — normal recommendation — P0

Use fixture values: Kuala Lumpur, 2026-09-01, two people, Nature; send `Plan a
nature day for us`.

Expected: one to three catalogue recommendation cards with stable Place IDs.
The assistant introduction is one short batch sentence and does not repeat each
place description. Reasons/trade-offs do not infer crowding from review counts,
road time from distance, or pickup suitability from a listed ride.

#### M6-G04 — vague request and missing fields — P0

In a new chat send `saya nak makan`, then answer only the field requested.

Expected: Guide asks one natural, relevant missing-field question at a time,
does not leak internal instructions, does not ask for a budget, and does not
claim recommendations were made before catalogue cards exist.

#### M6-G05 — specific-place information — P0

Ask about a named catalogue place, then ask a contextual follow-up such as its
opening hours.

Expected: the answer appears as structured chat text rather than a recommendation
card. It resolves the current Place ID, not only the name. If trusted live facts
are unavailable, it says so instead of presenting a generic description as the
opening-hours answer.

#### M6-G06 — destination-to-Guide hand-off — P0

1. Open `/discover/p_georgetown?date=2026-09-14`.
2. Choose **Ask Tumpang Guide**.
3. Confirm the hand-off status names George Town and shows an editable question.

Expected: no user message has been sent and no AI call starts automatically.
The hand-off carries `p_georgetown`, origin, date and return target. **Use this
question** fills the composer only. Returning restores the detail conditions.

#### M6-G07 — preserve an existing draft — P0

Apply F5, then enter Guide from a destination.

Expected: the user can choose **Keep original draft** or **Use this question**.
Test both paths. Neither silently deletes text or sends a message. Verify the
handoff text in English, Simplified Chinese, Malay and Tamil.

#### M6-G08 — refinement and conversation focus — P1

After recommendations, test `another place`, `too far` and a request for a
different category. Then ask a pronoun-based follow-up about one shown place.

Expected: constraints change the next catalogue search without inventing new
places; named/contextual place questions stay attached to the correct verified
place; older recommendations remain understandable as history.

#### M6-G09 — Guide actions require confirmation — P0

From a recommendation test Save interest and Ride alert.

Expected: confirmation dialog names the place/date; cancelling writes nothing;
confirming writes once; active state supports cancellation; unauthenticated
actions go through auth without automatic execution.

#### M6-G10 — emergency interruption — P0

Send `Someone is unconscious and needs an ambulance now`.

Expected: fixed emergency response and **Call 999** are shown, no destination
cards appear, and ordinary travel recommendation stops for that turn.

#### M6-G11 — language behaviour — P0

Run one short conversation in each language:

- English: `I want a nature place in Penang.`
- Simplified Chinese: `我想在槟城找一个自然景点。`
- Malay: `Saya mahu tempat alam semula jadi di Pulau Pinang.`
- Tamil: `பினாங்கில் இயற்கை இடம் வேண்டும்.`

Expected: response language follows the current message without corrupting
official place names. Handoff strings exist in all four languages. Review count,
seat, distance, interest and no-ride explanations remain factual in each.

#### M6-G12 — New chat and Past Plans — P1

Create a conversation, open Past Plans, restore it, then start New chat.

Expected: signed-in history restores the correct messages and context; New chat
does not mutate the old session; deleting a plan removes any active restored
copy. Guest conversations are not represented as server-persisted plans.

#### M6-G13 — browser voice and Groq fallback — P1, real hardware

For English, Chinese, Malay and Tamil: start voice, speak, stop, edit transcript
and send. Then simulate browser recognition failure and manually choose Groq
cloud transcription.

Expected: interim text is preview-only; final text fills the composer once and
never auto-sends; permission/network errors stop cleanly; cloud fallback records
again and does not silently upload prior audio.

#### M6-G14 — provider timeout/rate-limit recovery — P0, deployed environment

Exercise one normal Gemini-owned turn, then use a controlled staging setup to
make the primary provider fail and confirm the secondary performs the complete
turn. Finally make both unavailable.

Expected: no mixed-provider partial answer; same client turn executes at most
once; both-provider failure preserves plan/chat and offers transparent retry.
Correlate browser `traceId`, Edge version and server logs. A 429 or timeout is a
provider failure, not evidence that the user exhausted the Guide UI counter.

### H. Weather, lifecycle and demand

#### M6-H01 — weather modes — P1

Open `/home?date=2026-09-14&demo=1`. Test Clear, Heavy rain and Severe warning.

Expected: active simulation is labelled on every affected screen. Heavy rain
adds an advisory; severe mode withholds affected outdoor places; no unavailable
or out-of-range forecast is called good weather. Reset removes simulation.

#### M6-H02 — no silent date movement under weather withholding — P0

Apply Severe warning on a selected date.

Expected: selected date remains fixed. Withheld places are explained; the app
does not switch date or inject an unfiltered place to fill the list.

#### M6-H03 — browsing interest demand view — P1

Create an interest/alert, open `/discover/demand?date=2026-09-14`.

Expected: it describes browsing interest and lack of an available listed seat,
not committed passengers or proof that nobody will drive. A destination already
served by a ride with a seat is suppressed from this host opportunity view.

#### M6-H04 — lifecycle notification demo — P1, deployed environment

After registering an alert, open Home with `demo=1`, choose the registered place
and change its lifecycle state using the demo controls.

Expected: only an authorised deployed test account can perform the change;
notification names the affected place; restoring Active works. Reset state after
the test. Do not run this against presentation data without an agreed test row.

### I. Responsive, accessibility and PWA regression

#### M6-I01 — responsive layout — P0

On V1–V4 check Home, origin dialog, destination detail, score expansion, Guide
onboarding, Travel Brief, recommendation cards and action-confirmation dialog.

Expected: no overlap with top/bottom navigation; long place names wrap; primary
actions remain reachable; dialogs fit and scroll internally; phone keyboard does
not hide the composer; orientation change does not lose state. Absence of
horizontal scrolling alone is not sufficient—readability and tap order matter.

#### M6-I02 — keyboard and focus — P0

Use keyboard only through Home filters, origin dialog, detail actions, score
toggle, Guide composer and confirmation dialog.

Expected: visible focus, logical order, Escape closes dialogs, focus returns to
the opener, and modal focus cannot escape behind the dialog.

#### M6-I03 — accessibility semantics — P0

Check at 200% browser zoom and with reduced motion. Run the automated axe case.

Expected: labels remain associated, status/error messages are announced, colour
is not the sole state indicator, motion is reduced, and WCAG A/AA automated
violations remain zero in the covered critical pages.

#### M6-I04 — loading and slow network — P1

Use Slow 3G and then Offline after the shell has loaded.

Expected: skeletons resolve to content or a terminal retry state; no permanent
spinner; cached shell can open where designed; live facts, maps and AI honestly
report unavailable rather than inventing results.

#### M6-I05 — browser compatibility — P1

Smoke-test current Chrome/Edge desktop and one Android or iOS browser. Voice is
tested only where the browser exposes the required recognition API.

Expected: core browsing, filters, detail, Search hand-off and text Guide input
work even if optional browser voice is unsupported.

## 7. Live Supabase and catalogue verification

Run this group separately from fixture testing and avoid changing production
records unless a dedicated test account/place is available.

### L01 — catalogue sanity — P0

Check several states and all four categories. Verify Place IDs are stable,
lifecycle state is respected, retired rows are absent, state names are
normalised, and foreign-country rows are not recommendable. Spot-check long and
non-Latin official names.

### L02 — RLS and privacy — P0

Using two test users, verify one user cannot read another user's individual
interest rows, alerts or Guide sessions. Public demand exposes aggregate counts,
not identities. Guest writes are rejected or routed through sign-in.

### L03 — alert persistence — P0

Register an alert, reload, sign out/in, cancel and reload again.

Expected: exact place/date persists; one active row only; cancellation persists;
failed writes do not show success.

### L04 — real place and location services — P1

Test manual autocomplete and device reverse-geocoding for at least Kuala Lumpur,
George Town and one less common Malaysian town. Reject an ambiguous suggestion
rather than accepting approximate coordinates silently.

### L05 — weather — P1

Test a date inside the forecast range and one outside it.

Expected: available forecast is used; unavailable/out-of-range data is not
presented as favourable weather. Demo overrides remain visibly labelled.

### L06 — AI provider chain — P0

For each live Guide turn record response time, `traceId`, final result and the
corresponding Edge log. Verify normal primary success, controlled primary
failure with secondary success, both-provider failure and retry/idempotent replay.
Do not infer provider success from the visible answer alone.

### L07 — frontend/server version alignment — P0

Confirm the frontend prompt version and deployed Edge prompt version agree.
Clear old browser cache/service worker or perform a fresh-profile test after
deployment. A source change to `m6-tumpang-guide/index.ts` is not live until that
function is deployed.

## 8. Presentation rehearsal

Use this exact main line with a clean presentation account:

1. Open Home as a traveller already in Malaysia.
2. Show the current starting point and change it once.
3. Select a future date and Nature without changing long-term preferences.
4. Open one real, known destination and explain straight-line distance.
5. Expand scoring and explain the two axes without claiming pickup suitability.
6. Show the 10 km search note and enter Find a ride; point out the empty pickup.
7. Return, enter Guide with the destination hand-off, edit the draft and send.
8. Return to the destination with the Explore context preserved.
9. Show a no-ride destination, register a ride alert and explain that it is not
   a booking or guarantee.

Prepare two fallback tabs before presenting:

- a deterministic fixture no-ride + interest state (F2);
- a screenshot/log of transparent provider failure and retry.

Do not depend on a live provider response for the only demonstration of the
module. If external AI fails, say that the fixture verifies the application
contract while the live provider is currently unavailable.

## 9. Evidence record template

Copy one row per case into the presentation test record:

| Field | Value |
| --- | --- |
| Test ID | M6-___ |
| Build/commit | |
| Environment | fixture / deployed |
| Viewport/device | |
| Account | guest / test user |
| Start URL and state recipe | |
| Expected result | |
| Actual result | |
| Status | PASS / FAIL / BLOCKED / NOT VERIFIED / N/A |
| Screenshot/video | |
| Console/network/traceId | |
| Tested by and time | |
| Follow-up issue | |

For a failure, preserve the first failing screenshot, the full URL, console
error, failed network request and `traceId` before retrying. This makes the
difference between a UI regression, a data problem and an external-provider
failure defensible during the presentation.
