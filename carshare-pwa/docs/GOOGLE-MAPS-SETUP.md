# Google Maps Setup

## Accepted Cost Boundary

Module 2 uses two separate website-restricted browser keys:

- **Maps Embed API** for directions previews. Google currently documents Embed
  as no-charge with unlimited requests.
- **Maps JavaScript API + Places API (New) + Geocoding API** for confirmed
  Malaysia-only Autocomplete suggestions, one-shot current-location reverse
  geocoding, and the five nearest pickup-friendly Google places disclosed only
  after the Driver selects `Use current location`. Nearby Search requests
  `displayName`, `formattedAddress`, and `location`, so Google bills them under
  the Nearby Search Pro SKU. The app does not request Place Details or create a
  Dynamic Maps instance.

Google currently lists separate monthly 10,000-event free usage caps for
Autocomplete Requests and Geocoding. Free usage is calculated per SKU, not as
one shared Maps allowance. Routes Essentials also has its own free cap, but
that is not the production spending boundary: production route quoting requires
a hard 250-request daily limit plus alerts and the database-side daily guard.

Do not enable Routes on either browser key. Static Maps, Dynamic Maps, Street
View, and other unused APIs remain disabled.

Official references:

- https://developers.google.com/maps/documentation/embed/usage-and-billing
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/billing-and-pricing/manage-costs
- https://developers.google.com/maps/documentation/javascript/nearby-search
- https://developers.google.com/maps/documentation/places/web-service/data-fields
- https://developers.google.com/maps/documentation/places/web-service/place-id
- https://developers.google.com/maps/documentation/routes/specify_location
- https://developers.google.com/maps/api-security-best-practices

## Cloud Project

```text
Project ID: my-project-cd-505310
Embed service: maps-embed-backend.googleapis.com
Location services: Maps JavaScript API, Places API (New), Geocoding API
```

The owning Google account is intentionally not recorded in the repository.

## Safe Console Setup

1. Select project `my-project-cd-505310` in Google Cloud Console.
2. Confirm its billing account is the intended free-trial account. Maps Embed
   still requires billing to be enabled even though its requests are no-charge.
3. Enable **Maps Embed API**, **Maps JavaScript API**, **Places API (New)**, and
   **Geocoding API**. Enable **Routes API** only when the local `027` deployment
   gate below has been approved. Leave all other Maps APIs disabled.
4. Create a dedicated API key named `lets-tumpang-web-embed`.
5. Set its Application restrictions to **Websites** and allow only:
   - `http://localhost:5173/*`
   - the final HTTPS deployment domain, once known.
6. Restrict that key to **Maps Embed API only**.
7. Create a second key named `lets-tumpang-web-locations`, apply the same
   website restrictions, and restrict it to **Maps JavaScript API**, **Places
   API (New)**, and **Geocoding API only**.
8. Configure the lowest practical daily hard quotas for Autocomplete,
   Geocoding, and Places API (New) Nearby Search, with an initial operational
   target of **250 requests per day for each used request class**. Disable
   automatic quota increases. Confirm in the actual Cloud project how the
   Places API quota groups Nearby Search before production; if Cloud Console
   does not expose an enforceable hard limit, keep the feature out of the
   production environment until a separately approved cost boundary exists.
9. Configure 50%, 75%, and 90% usage alerts for all three request paths and a
   low project-level billing budget alert that includes Nearby Search Pro.
   Alerts are notifications and do not stop requests; the hard quota is the
   production cost boundary.
10. Put both keys in the ignored `.env.local` file:

```text
VITE_GOOGLE_MAPS_EMBED_API_KEY=your_restricted_browser_key
VITE_GOOGLE_MAPS_PLACES_API_KEY=your_restricted_location_key
```

11. Restart Vite after changing the environment file.

Vite browser variables are visible to users by design, so website and API
restrictions are the actual security boundary. Never commit `.env.local`.

## Server Routes Deployment Gate

Migration `027` and the two Module 2 Edge Functions are deployed. The two
internal signing secrets and a dedicated Routes-only server key are configured,
and the bounded ETA backfill completed for the two eligible future rides on
2026-08-14. Google Cloud reports the Routes daily quota as unlimited and
non-adjustable. The server-only key is held exclusively by the Edge Functions,
and `consume_m2_route_quota` is the enforced fail-closed limit of 250 attempted
Routes calls per Malaysia day; Cloud usage alerts remain an operational task.

1. Create a dedicated key named `lets-tumpang-server-routes`. Never put it in a
   `VITE_` variable or browser bundle.
2. Restrict the key to **Routes API only** and apply the strongest supported
   server/application restriction for the chosen Edge runtime.
3. Confirm Google Cloud's quota behaviour and configure 50%, 75%, and 90%
   usage alerts where Cloud exposes a supported signal. This project reports
   the Routes daily quota as unlimited and non-adjustable; do not enable quota
   adjuster. The database guard is the enforced 250-request Malaysia-day cap,
   and it rejects before Google is called.
4. Set Edge secrets `GOOGLE_ROUTES_SERVER_KEY`, `M2_ROUTE_QUOTE_SECRET` (at
   least 32 random characters), `M2_ROUTE_BACKFILL_SECRET` (at least 32 random
   characters), and `M2_ALLOWED_ORIGIN` (one exact app origin or a
   comma-separated local + production origin list; never `*`).
5. Apply migration `027` only after live migration history is checked, then
   deploy `m2-route-quote` and `m2-route-backfill` together. Never deploy the
   frontend route flow before both server pieces are ready.
6. Run the backfill in batches no larger than 25. A failed or legacy route must
   be shown as “Driver confirmation required”; never substitute a guessed ETA.

The database guard counts at most 250 attempted Google Routes calls per Malaysia
day and fails closed before Google is called when exhausted. It complements,
but does not replace, the required Google Cloud hard quota.

## Runtime and Cost Safety

- Autocomplete starts after one character and a 1,000 ms pause, is restricted
  to Malaysia, and shows at most five results. Choosing a prediction stores its
  display text and Place ID without a Place Details request.
- Publish Ride checks for at least one registered vehicle before requesting
  location permission. Eligible Hosts receive one automatic high-accuracy
  browser geolocation request that centres an Embed `view` preview only; there
  is no background tracking and this coordinate is not saved as pickup.
- Choosing `Use current location` always requests one fresh high-accuracy GPS
  reading. At 100 metres or better, the same reading is reverse geocoded and
  immediately becomes the device-coordinate Pickup while Nearby Search runs in
  parallel. At 101–500 metres, the GPS point is not selected but may still
  anchor five pickup-friendly alternatives. Above 500 metres, neither Google
  request is made. Nearby Search uses a 5 km circle, distance ranking, and at
  most five results. No Nearby Search runs before this explicit button action.
- Automated tests mock Google and browser geolocation. They must make zero real
  API calls.
- If the location key is absent, offline, or over quota, existing Ride text and
  Embed previews remain readable, but a new unconfirmed location cannot be
  saved. If the Embed key is absent, the local route illustration remains.
- The deployed Edge Function calls Routes API with traffic-aware
  routing only during Review/Publish or the bounded backfill. The server key is
  never returned to the browser. Quote tokens expire after five minutes and are
  encrypted plus HMAC-signed so private route anchors are not exposed.

## Controlled Smoke Test

Run this only after both hard quotas and alerts are visible in Cloud Console:

1. Record Autocomplete, Geocoding, and Nearby Search Pro usage before the test.
2. Select one pickup and one destination from Google suggestions.
3. Resolve and confirm current pickup once with browser geolocation.
4. Confirm the counters increased only for the expected Autocomplete,
   Geocoding, and Nearby Search Pro SKUs and that Routes usage remains zero.
5. Do not repeat the smoke test merely to exercise UI states; use mocks for all
   regression and responsive tests.
