# Module 6 user journey review and implementation record

Date: 2026-09-12. Baseline: Development 38f5700, merged into personal
Module6_Trust_And_Safety at a53e4c2 with an identical file tree.

## Scope and evidence

This document records the source review that shaped the approved Module 6
improvements, followed by the implementation status. Development remains
unchanged; the implementation is on the personal Module6_Trust_And_Safety
branch only.
This is a source-based cognitive walkthrough, not an observed usability study,
live provider test, database audit, or responsive visual verification.
Personas below are test scenarios, not claims about all foreign travellers.
The user's Word report describes intended functionality; it is not proof that
every documented behaviour currently executes that way.

Paths below are relative to carshare-pwa. Main source roots:
- H: src/presentation/m6-discovery/HomeScreen.jsx
- D: src/presentation/m6-discovery/components/discover/DestinationDetail.jsx
- S: src/business-logic/m6-discovery/discovery/DestinationDiscoveryService.js
- A: src/business-logic/m6-discovery/discovery/DiscoveryContractAdapter.js
- E: src/business-logic/m6-discovery/discovery/DestinationScoringEngine.js

## Previously identified issues and resolution

| ID | Finding and source | Status |
| --- | --- | --- |
| U01 | H and D send DEFAULT_ORIGIN (Kuala Lumpur), while distance reads as distance from the visitor. Guide's configurable origin does not repair this discovery flow. | Resolved: origin is shown as an explicit default, can be confirmed manually or by location, and is shared by list/detail in the tab session. |
| U02 | H initial load can replace the requested date when primary is empty and departureDates exist, without an explanatory confirmation. | Resolved: the selected date remains fixed; related future dates are offered as explicit choices. |
| U03 | H filters primary/unserved by searchQuery, but moreInCategory and allWithheld do not apply that query. | Resolved: category and text filtering use the same predicate for every visible result group. |
| U04 | H invites passengers to drive and promises seats will fill themselves; D makes I will drive primary when no rides exist. | Resolved in presentation: ride state, notification and publish actions are separated and no seat-fill guarantee is shown. The host action remains available as a deliberate platform action. |
| U05 | mediaMode.js defaults photos off. Visitors unfamiliar with names may lack visual/geographic context. | Accepted trade-off: media remains on-demand; illustrations, real photos and Street View are labelled honestly, and the detail page offers the richer visual context. |
| U06 | GuideOnboarding.jsx leads with catalogue/Place ID and privacy mechanics rather than first-task guidance. | Deferred to the Guide-specific scope; this discovery pass only adds the destination-to-Guide handoff. |
| U07 | H maps every guest load failure to sign-in required, including failures not established as authentication failures. | Resolved: ordinary catalogue, ride and interest failures have retry/recovery states and do not require sign-in; protected actions keep their own auth flow. |

## Deeper discovery walkthrough

| ID | Scenario and mismatch | Evidence and limits |
| --- | --- | --- |
| J01 | A visitor in Penang sees a ride to a destination and assumes it is usable from their hostel. Destination matching does not establish accessible pickup, departure-time feasibility, party capacity or return travel. | Constrained in the UI: a listed ride is explicitly described as destination coverage only, with pickup, time and remaining seats still to be checked in Module 4. A return journey is outside this module. |
| J02 | A place with a ride appears beneath Nobody is driving here yet. | Resolved in presentation semantics: the second area is neutral, and each card independently states its known ride state. Score thresholds and weights are unchanged. |
| J03 | Mobile network failure becomes Nobody is driving here yet. | Resolved: ride reads return an explicit unavailable state, which is displayed separately from a confirmed zero-ride result. |
| J04 | I selected a date and origin; Find a ride should retain them. | Resolved: detail and Find a ride carry the selected date and destination; the ranking origin is retained as context but is not silently used as a confirmed Module 4 pickup point. |
| J05 | Guest registers a notification for a future date, signs in, and returns with the same intention. | Resolved in the handoff: the date remains in the auth return URL, notification copy names the destination/date context, and the same action becomes a cancel/retry state. |
| J06 | I compare three places then return to my filtered results. | Resolved: the full Explore URL and scroll position are saved before opening detail and restored on return, with a safe Home fallback. |
| J07 | A quick look at a photograph is not necessarily intent to travel on a date. | Preserved as an explicit product signal: opening a destination records weak interest, while notification remains the separate strong action. A failed interest write no longer blocks detail navigation. |
| J08 | A backpacker can walk or use transit to a place with no platform ride. | A is explicitly weighted toward carpool supply. No ride means at most .45, excluding primary even for a walkable place. This is a product-scope decision, not automatically a bug; wording should distinguish carpool availability from general reachability. |
| J09 | A national catalogue should not make a long trip look easier simply by adding a much farther place. | E.computeJourneyCostSignal uses distance/maxCandidateDistance; geo.js uses great-circle distance. 100 km gives .50 when maximum is 200 km, .95 when maximum is 2000 km. No road/ferry/flight or travel-time inference is supported by this signal. |
| J10 | Today I want nature even though my last ride was to a restaurant. | Resolved: an explicit category selection filters and prioritises this request for the current load without overwriting saved history or preferences; All restores the existing affinity path. |
| J11 | Not already overrun sounds like current crowd information. | Resolved in copy: headroom is described through review coverage and comparison with peers; it is not presented as live crowd information. |
| J12 | Before committing, I need to know where exactly, whether I can visit then, and how to return. | D visibly supplies state, distance, descriptions, reviews, optional travelNote and imagery; it does not render structured opening hours, visit duration or a return plan. These are visitor decision gaps, not evidence that data is absent everywhere or a mandate to build a full itinerary planner. |
| J13 | A weak connection should offer recovery. | Resolved: destination loading has a terminal failure state with retry, and optional interest writes do not block opening the place. Browser checks cover the fixture failure paths; live backend failure behaviour remains an external verification item. |

## Scenarios for discussion and later validation

1. First-time visitor already in Penang, no account, no location permission:
   understand ranking origin, choose a destination, inspect it and return.
2. Visitor planning Malaysia from overseas: explicitly choose the future travel
   origin instead of assuming device location is the trip origin.
3. Car-free backpacker with only this afternoon free: understand whether no
   platform ride rules out visiting; do not change their date automatically.
4. Two travellers at a hostel: distinguish a matching destination from a ride
   with reachable pickup and enough seats; do not imply a return is arranged.
5. Guest seeking an alert for a future date: sign in, preserve date, clearly
   confirm what was registered and how to cancel it.
6. Slow connection: distinguish load failure from no places/no rides; viewing
   a place should not depend on a successful optional interest write.

## Accepted boundaries and remaining verification

- Retain the two axes, but make the product promise precise: destination
  inspiration plus carpool opportunities, rather than universal travel access.
- Separate factual ride state from score thresholds and recommendation order.
- Keep origin/date consistent across list, detail, login and search; never
  silently broaden a constraint to manufacture a nonempty result.
- Separate fixed travel conditions from preferences and platform objectives.
- Present unknown information honestly; do not invent prices, crowding, hours,
  halal status, accessible transport, return journeys or waiting-time guarantees.
- Do not reintroduce the removed AI budget feature. Price visibility and
  affordability are distinct discussion topics and require verified data.

The implementation keeps the two scoring axes, weights and thresholds from the
submitted design. It changes the surrounding explanation and state handling so
that a recommendation, a destination with no listed ride, a full ride and an
unavailable ride are not presented as the same fact. It also keeps the removed
AI budget feature out of this flow.

Verification completed on 2026-09-12 in the personal branch:

- 129 Vitest files, 1,424 tests passed.
- Layer-boundary and local-cycle check passed.
- Production build passed.
- Responsive Playwright checks: 106 passed, 2 intentionally skipped.
- The browser checks use offline fixtures; live Supabase, Google Places, ride
  availability and notification delivery still require the user's deployed
  environment to be exercised separately.
