# Module 2 — Ride Sharing Management

## Owner
Yee Zu Yao

## Purpose
Core ride publishing, ride requests, host request management, and lifecycle behaviour.

## Requirement Intent
Publish ride, pickup/destination/date/time/seats/vehicle, non-monetary contribution/restrictions, request to join, details/status, accept/reject, edit/cancel, lifecycle, review, route/waypoints.

## Existing Repository Areas
Presentation: `src/presentation/components/ride/` including `RideHub.jsx`, `PublishRide.jsx`, `RideCard.jsx`, `RideDetail.jsx`, `ManageRequests.jsx`, `MyRequests.jsx`, `EditRide.jsx`, `RateReview.jsx`.
Business logic: `src/business-logic/RideService.js`.

## Owns
Ride entity behaviour, publishing/request flows, host decisions, ride lifecycle contract.

## Depends On
Module 1 eligibility/profile/vehicle; Google Maps; Module 3 group membership after acceptance; Module 5 read-only history/impact consumption.

## Provides
Ride data, accepted participation context, lifecycle state, searchable rides.

## Current Status
Module 2 is connected to the shared Supabase project through `RideService.js`,
`RideRequestService.js`, and `RideReviewService.js`. Deployed SQL `006-015`,
`020`, and `023` covers ride publishing, authoritative `departure_at`, multi-seat
requests, atomic acceptance/cancellation, manual recruitment close/reopen,
automatic departure-time lifecycle processing, and mutual Completed-ride
reviews. The same interfaces and state rules exist in the offline mock adapter;
its automatic lifecycle processing is deterministic and lazy.

Module 1 now consumes Module 2's verified completion, on-time Check-in,
cancellation, No-show, and review outcomes as Reputation events. The client
checks a Driver before opening/publishing and a Traveller before requesting;
authored undeployed migration `065` adds the authoritative database triggers,
65 Driver minimum, 50 Traveller minimum, three-Ride provisional access, and
safety-hold override. Driver and requester identity rows link to the safe
`/users/:userId` public profile. Module 2's contribution remains non-monetary.

The Ride UI now foregrounds the existing `rideJourneyState` next action with
role, timing, and responsible party. Publish keeps its five-step unlock,
location confirmation, quote invalidation, and Draft contracts while adding
focused validation recovery and responsive actions. Ride/request confirmations
use the shared adaptive dialog; no lifecycle or service contract changed.

Accepted decision D025 and authored, undeployed migration
`056_m2_lifecycle_expiry_and_validation.sql` make the database the only status
authority. Published rides without an Accepted request expire at departure;
rides with an Accepted request become Matched and receive a 30-minute Start
grace. At the exact deadline, every unstarted Published/Matched Ride and its
remaining Pending/Accepted requests becomes Expired. Accepted-to-Expired rows
retain `accepted_at` and boarding facts without assigning No-show. Close
recruitment requires an Accepted request, and cancelling the final Accepted
passenger before departure restores Matched to Published while the one-hour
request cutoff remains enforced.

Active operations and live/family location remain strict `Accepted`-status
capabilities. Only an Expired former participant with non-null `accepted_at`
gets terminal detail and sampled route-history access. Trip Mode is the sole
Check-in, No-show, Start, and arrival-confirmation surface; Ride Detail is a
lifecycle summary/entry point and Manage Requests is pre-departure
Accept/Reject plus history. Ride Hub and My Requests recompute countdowns on a
visible clock and refresh on focus, so a delayed Cron cannot leave an action
visible after the deadline.

Deployed migration `028_m2_route_schedule_and_completion.sql` and the deployed
`m2-route-quote` / `m2-route-backfill` Edge Functions upgrade the schedule
and completion contract. Published rides, request submission, and recruitment
reopening use one shared one-hour boundary. Existing Pending requests may still
be accepted or rejected
until departure. Pending requests do not reserve seats. A Host accepting a
request locks and checks the ride before deducting the whole request, so partial
acceptance and overselling are not allowed. Companion names are visible only to
the requester and Host and do not become account participants.

Published creation and Published edits use a five-minute encrypted, HMAC-signed
server quote bound to the Driver, vehicle, full confirmed route, ordered
waypoints, stop minutes, and departure time. Google Routes calculates the
traffic-aware driving duration at Review time; stop minutes are added to the
ETA, and the occupied half-open interval ends 30 minutes after ETA. A per-Driver
profile-row lock serializes publication. Overlaps, equal departure times, a
second concurrent publication, an existing active Ride with no ETA, and any
existing `In Transit` Ride are rejected in the database transaction. Browser
clients can create/update Drafts but cannot call the old direct publish RPC.

Waypoints now require a confirmed Google Place ID, order, and `stopMinutes`
(0-180). Legacy waypoint JSON stays readable and is marked for reconfirmation;
no Place ID is fabricated. Any route, waypoint, stop, vehicle, or departure
change invalidates the prior quote and ETA.

The verified lifecycle is now narrow-RPC based. Accepted passengers may check
in during the final hour only with GPS accuracy at most 100 m and within 200 m
of the private pickup route anchor. Only the result, distance, and timestamp are
stored; submitted GPS coordinates are not persisted. At departure the Driver
must mark unresolved accepted passengers No-show, and at least one accepted
passenger must be checked in before `In Transit`. At the destination, the
Driver confirms GPS within the same accuracy/distance limits and every checked-in
passenger confirms arrival. No-show passengers are excluded. The existing
minute Cron completes immediately after all confirmations or after the Driver's
24-hour confirmation deadline.

New Publish Ride drafts require at least one registered Host vehicle and
confirmed Malaysia-only Google location suggestions for pickup and destination.
When a Host resumes a Draft, publishing merges the current form values before
validation and route submission, so an edited departure date/time replaces the
stale persisted Draft timestamp and is checked against the same fresh quote.
The entry gate checks vehicles before requesting location permission. Eligible
Hosts receive one automatic device-location request that shows a current-position
pin in the Embed preview; it is neither persisted nor treated as pickup. Once a
complete route is selected, Directions Embed automatically fits the viewport to
the journey distance. Pickup may use the device location only
when GPS accuracy is 100 metres or better, reverse geocoding succeeds, and the
Host confirms the result. Place IDs are stored for Google selections;
device coordinates are stored only for a confirmed current-location pickup.
Editing the displayed text invalidates the reference immediately. Optional
public pickup instructions are limited to 300 characters and follow the same
accepted-request/status edit lock as the Ride.

`database/sql/020_m2_add_route_locations.sql` contains the required nullable
columns, constraints, and replacement create/update RPC signatures. It was
deployed to the shared project on 2026-08-13.

Route and waypoint previews continue to use Maps Embed API directions mode.
The builder sends Place ID or coordinate references when available and falls
back to saved text for legacy Rides. Legacy rows without canonical references
remain readable and may edit non-route fields without fabricated location data.

Migration `016_m3_supabase_messaging.sql` preserves the public
`respond_to_ride_request(request_id, decision, reason)` interface and seat logic.
For an Accepted decision it also creates/reuses the ride group and adds the
accepted account holder in the same database transaction. Existing Accepted
requests were backfilled during deployment. Companion names remain request data
and are never conversation members. Published Ride Detail also exposes Module
3's independent `Message host` direct-chat entry for non-Hosts.

The Module 2 presentation follows the shared `docs/ai/UI.md` phone-first
contract across the ride hub, publishing, detail, request management, editing,
and review flows. Primary mobile actions sit above the shared bottom navigation
and safe area, interactive controls use visible labels and at least 44px touch
targets, sheets become centred dialogs on wider screens, and ride listings and
details reflow into tablet/desktop grids without changing the service contract.
Publish Ride unlocks its Route, Schedule, Vehicle, Trip Details, and Review
steps sequentially. The desktop step rail links only to the current or already
unlocked steps, and invalidating an earlier required step blocks forward jumps
until it is complete again. Review exposes an explicit Back action on phone and
desktop. Edit Ride loads the Host vehicle list, shows the selected vehicle, and
retains the pre-027 Host-only full-row fallback for environments that have not
yet applied migration 028.
Responsive verification targets are 375px, 768px, 1024px, and 1440px.

The authenticated Ride workspace is action-first. `/ride` combines Driver and
Passenger journeys into one departure-ordered overview, while each card keeps
an explicit role badge. The shared pure `rideJourneyState.js` model ranks one
cross-role next step above the complete list, so the user does not need to pick
a role before seeing the most urgent action. The same model drives Ride cards,
My Requests, and Ride Detail so terminal Rides cannot expose check-in or
cancellation actions. Draft cards resume the existing five-step publisher at
`/ride/:rideId/publish`, can be deleted with confirmation, and a successful
publish opens the new Ride Detail with a success/next-step notice.

Completed, Cancelled, and Expired Driver cards in History always open Ride
Detail first. Its desktop action rail (and phone bottom action area) offers
`Publish again`; for a Completed Ride, the review action appears immediately
above it and is the only control that opens `RateReview`. `Publish again` uses
the deployed Host-only `republish_m2_ride_as_draft` RPC and opens the existing
five-step publisher for review and editing. The old schedule
is intentionally copied even when stale, but normal publication still requires
a new valid departure time and fresh server route quote. Requests, lifecycle
state, route/ETA results, live location, conversations, reviews, statistics,
and the old pickup photo stay bound to the original Ride.

Requester cancellation is an immediate requester-owned transition, not another
Host decision. Host approval applies only while a join request is `Pending`; a
`Cancelled` request is written immediately, restores seats when it was
`Accepted`, notifies the Driver, and must never be rendered as “awaiting
approval”. If the Published Ride is still open, the former requester may submit
another request after cancellation.

Ride Detail keeps `/ride/:rideId` as the single execution surface. Drivers and
Accepted passengers enter `?view=trip` by default in the final hour or while In
Transit, while `?view=details` remains explicitly available. Trip mode shows
the route, countdown, pickup instructions, navigation, the existing Module 3
ride-group chat, and exactly one primary lifecycle action. Driver readiness and
No-show handling are inline. Local migration
`037_m2_early_start_and_eta_refresh.sql` and the matching `m2-route-quote`
update allow Start before the scheduled departure only after every Accepted
passenger is Checked In. After departure, at least one Checked In passenger is
enough and remaining unresolved passengers are marked No-show. The operation
records the actual `started_at` and replaces ETA with a guarded Google Routes
traffic calculation anchored to the actual start. The client no longer calls
the legacy direct `start_ride` RPC.
Visible Trip mode refreshes
Ride, Request, and lifecycle context every 15 seconds and immediately after
focus or a local mutation without adding a new Realtime publication.

Module 4 Search and Published Ride Detail are public browsing surfaces. The
bare `/ride` route is the authenticated workspace for hosted and joining rides;
the former basic RideHub search has been retired. Guests are sent to the shared
auth page only when they select Ride management, Publish, Request to
join, Message host, or another account-specific Ride action. Migration
`023_m1_m2_public_ride_browsing.sql` is deployed with column-scoped anon reads
for only Published rides from active Hosts plus the safe profile and impact
fields used by public ride cards. Migration `027` adds only
`estimated_arrival_at` to that anonymous column grant. Place IDs, precise
coordinates, pickup instructions, check-in distance, quote metadata, and
lifecycle confirmations stay out of the guest/list payload. Route anchors are
held under the private schema and the short-lived client quote is encrypted as
well as signed.
Requests, vehicles, reviews, and messaging remain authenticated/private.

Module 4 continues to obtain candidate rides through
`RideService.searchRides()`. Its optional compatibility criteria delegate to
the safe public RPC authored in migration `039`, while existing callers retain
the previous exact/proximity behaviour. Public cards may show only the selected
vehicle category and Host spoken-language set when classified; vehicle
make/model/plate, Place IDs, coordinates, and other private fields are never
added to the public result. Migration `039` is deployed; the guarded fallback
remains only for other environments that have not applied it.

For FR-6.35, Module 2 consumes the optional `destination` and `date` query
parameters on `/ride/publish` defined in `docs/ai/FR-6.35_PREFILL_CONTRACT.md`.
It may display an incoming label, but only the normal confirmed-location input
can establish a Google location reference.

## Deployment Gate / Deferred

Migration `027` and both Edge Functions were deployed to project
`pnetstmovctfwqcumodx` on 2026-08-14. `M2_ROUTE_QUOTE_SECRET` and
`M2_ROUTE_BACKFILL_SECRET`, and the dedicated Routes-only server key are
configured. The one-time ETA backfill completed for the two eligible future
rides. Google Cloud reports its Routes daily quota as unlimited and
non-adjustable, so it cannot provide the requested 250/day platform ceiling;
the dedicated key is available only to these Edge Functions and the database
enforces the fail-closed 250-request Malaysia-day cap before Google is called.
Cloud usage alerts remain an operational follow-up. Failed/legacy rows must ask
the Driver to reconfirm; no fixed-duration ETA fallback is allowed.
Route-deviation automation and map-pin selection remain deferred. Messaging
notifications now use the shared Module 3 notification centre through deployed
`038_m2_ride_usability_notifications.sql`.

Migration `037` is applied through the Dashboard SQL Editor and the updated
`m2-route-quote` is active as version 11. The SQL file remains the repository
record because the Dashboard-applied change is absent from migration history.
The frontend must still be rebuilt from the matching client code; deploying
only the frontend before the Function leaves early Start unavailable, while
deploying only the migration leaves no client path to the service-role-only
traffic refresh.

`038_m2_ride_usability_notifications.sql` is implemented locally and depends on
the deployed `033_project_notifications.sql`. It adds only private
Module 2 producers and a one-minute reminder function: request decisions,
cancellations and arrangement changes, boarding events, 24-hour/final-hour/
departure reminders, Driver arrival, and completion. Stable recipient-scoped
dedupe keys allow retry/catch-up; departure alerts are bounded to 30 minutes.
Notification text and payloads exclude Place IDs, coordinates, pickup
instructions, and companion data. This work
does not change or deploy Web Push, VAPID, service workers, subscription APIs,
Edge Functions, or Database Webhook configuration.

## Module 2 Improvement Rollout (2026-08-24)

Migration `038` is now deployed as `m2_ride_usability_notifications`; it uses
the shared Module 3 notification inbox, unread Realtime count, Web Push and
service-worker path. Module 2 does not create a second notification centre.

Passenger check-in uses adaptive GPS tolerance from deployed migration `041`:
accuracy must be at most 150 m and measured distance must be at most
`min(200 m + accuracy, 350 m)`. Driver destination arrival intentionally keeps
the existing 100 m accuracy and 200 m distance limits. Authored, undeployed
follow-up `049` preserves nullable accuracy only for historical Checked In rows;
every new check-in still writes the measured accuracy.

Authored, undeployed migration `058_m2_widen_checkin_tolerance.sql` makes the
requested small passenger-only adjustment to `min(250 m + accuracy, 400 m)`.
It retains the 150 m accuracy ceiling, historical nullable-accuracy
compatibility, coordinate non-persistence, and the Driver arrival limits.

Publish Ride autocomplete supplies a 5 km location bias and origin only when
the existing foreground preview is at most 500 m inaccurate. Malaysia remains
the restriction and the returned Google distance is shown to the user. The
same input contract is used by pickup, destination and waypoint selection.
Only after the Driver selects `Use current location`, the browser obtains one
fresh GPS reading and uses it for both reverse geocoding and Google Nearby
Search. At 100 m accuracy or better, the reverse-geocoded device coordinate is
immediately retained as Pickup while up to five pickup-friendly alternatives
within 5 km appear in distance order. At 101–500 m, no GPS Pickup is selected,
but the same alternatives can still be chosen. Above 500 m no Nearby request is
made. The automatic map preview, focusing an empty field, and the Destination
field do not trigger or reveal nearby options. This Create Ride source is Google
Nearby rather than Module 6's catalogue; typing continues to use normal Google
autocomplete. Nearby Search Pro billing, quota and alert requirements are
recorded in `docs/GOOGLE-MAPS-SETUP.md`.

`M2WaypointRecommendationService` consumes the host-only
`recommendationRoute` returned by `m2-route-quote`, asks Module 6's
`PlaceQueryService` for a 5 km corridor, filters culinary/heritage places,
sorts by route progress, removes selected Place IDs, and caps the panel at six
items. Selecting one first expands a 0-180 minute integer editor with a
30-minute default; Add/Cancel completes the choice, and an added waypoint's
duration remains editable. A failed recommendation request falls back to
manual waypoint entry; adding, removing, or editing a waypoint invalidates the
quote and requires a fresh final route quote.
Publish now renders those suggestions inside the existing Culinary & cultural
waypoints builder, above an explicit “Or add your own stop” path, instead of as
a separate Review card. The preserved recommendation route lets the Driver add
more than one suggestion while the final route quote remains correctly stale.
The quote fingerprint contains only the host-bound vehicle, confirmed route
locations, departure and ordered waypoint Place IDs/stop minutes, so changing
contribution, restrictions, pickup instructions or display copy does not spend
another Routes request.

Waypoint cards prefer the academic Module 6 cached photo reference and lazily
fall back to a fresh Google Maps JavaScript `Place` photo. Bytes, fresh URIs and
new resource names are never persisted. This is the documented D018 prototype
limitation: Google permits indefinite Place ID storage, but photo references
and URIs can expire and are not a production cache contract.

The live `059_m2_ride_pickup_destination_photos.sql` contract
adds one private pickup meeting photo per Ride. Create/Edit keeps the selected
JPEG/PNG/WebP locally, corrects orientation, limits the longest edge to 1600px,
prefers WebP, and uploads only after the Ride save succeeds. A failed photo
operation never republishes the Ride: the Driver can retry or continue without
the photo. Published Ride Detail exposes the instructions and signed photo to
visitors through a narrow RPC plus `m2-ride-pickup-photo`; Trip Mode and every
Ride Card omit this pickup photo. Search, Favourite, and `/ride` cards instead
use an attributed, lazy Google destination photo when available and keep their
existing non-photo design as the fallback. Standard Ride Detail also shows the
same on-demand, attributed destination photo; Trip Mode remains photo-free.
Tracked migration `060_m2_allow_pickup_photo_upload_return.sql` is deployed and
adds the narrowly owner/path/Ride-scoped Storage `SELECT` required for upload
metadata to be returned without weakening the private bucket. The
`m2-ride-pickup-photo` Edge Function is active as version 1.
Tracked migration `066_m2_fix_pickup_photo_storage_path_policy.sql` corrects the
same policies' folder-count check: `storage.foldername(name)` excludes the
filename, so the `user-id/ride-id/filename` upload path has two folders.

The deployed `047` contract provides explicit opt-in foreground live tracking,
latest points, sampled history, filtered Driver/passenger visibility and
expiring family links. The PWA labels hidden/locked-screen tracking as best
effort and never uses a live point to trigger Check-in, Start Ride or arrival.
Viewing and sharing are independent: an Accepted passenger can observe an
opted-in Driver without sharing, the Driver sees opted-in passengers, and
passengers never see one another.

Module 5 consumes cursor-paginated history through `TripRouteReplay`; family
links never receive history. Family payloads contain only `driver` and
`shared-passenger` marker IDs, return scheduled/waiting/active states, expire
with the latest planned departure, and become invalid on a terminal Ride. The
anonymous family page is map-first: it refreshes the latest permitted Driver
and shared-passenger points every ten seconds, shows freshness/accuracy and a
Google Maps fallback, and never requests the viewer's own location.

## Trusted Family and PWA SOS (authored, deployment gated)

Migration `061_m2_sos_trusted_family.sql`, advisor follow-up `062`, and
`notification-push` version 11 are deployed; the matching client remains
release-disabled. Trusted Family is a one-way, account-level
relationship claimed through a hashed, one-use invitation that expires after
24 hours. A trusted user has no ordinary Ride or location access. During an
active SOS they may open authenticated `/sos/:eventId` and receive only status,
the actor's display name, latest retained point, accuracy and update/signal
times. The page uses the same responsive live-map presentation as Trip Mode,
while clearly labelling stale or signal-lost points as last known rather than
live. Resolved deep links remain coordinate-free for 24 hours.

Trip Mode exposes SOS to the Driver and Accepted passengers only from one hour
before departure until a terminal Ride. Pointer users hold for two seconds and
receive a five-second cancellation window; keyboard and assistive-technology
activation uses a normal confirmation dialog. The server event is created even
when GPS is denied, no trusted family exists, or no recipient has Web Push, and
the UI reports those degraded states. While SOS is active, ordinary Stop
Sharing is locked; only the actor's “I'm safe” flow or a terminal Ride resolves
it. The manual flow requires the actor to type the case-sensitive phrase
`I am safe` before its final confirmation button becomes available.

The PWA keeps the geolocation watcher when the page is hidden and retries the
latest in-memory point after reconnect, but makes no background-GPS guarantee.
The server retains the last point for active SOS, marks it stale in the client
after 30 seconds and signal-lost after 120 seconds through minute Cron. All
active trusted family receive shared notification-centre events
`sos_activated`, `sos_signal_lost`, `sos_signal_restored`, and `sos_resolved`;
Push payloads contain no coordinates. Android foreground services, Capacitor,
FCM, SMS and iOS-native work remain out of scope.

When the release flag is enabled, an unread foreground `sos_activated`
notification also opens a global call-like alert for the Trusted Family
recipient. It is not a voice call and never creates a Module 3 call session or
requests microphone access. The shared Web Audio ringtone is attempted even
when general Alert sounds are off, runs for at most 45 seconds, and then reduces
to a persistent non-modal SOS bar. `View SOS` marks the activation notification
read and opens the existing authorized page; Silence or Escape stops only the
sound. Signal-loss, recovery, and resolution keep their ordinary notification
behaviour, while resolution removes the matching foreground alert. Background
or closed-PWA delivery remains operating-system-controlled Web Push.

D024 supersedes the `043-049` Trust Admin/ride-dispute experiment. The deployed
`055_m2_remove_trust_admin.sql` compensation migration removes its tables, RPCs,
notifications and evidence holds without rewriting deployed history. The
original browser-local `/safety` verification demo remains; `/safety/admin` and
the two production Admin Edge Functions are removed. `m2-live-share` version 4
is active and returns only the privacy-safe family snapshot.
