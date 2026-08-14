# Google Maps Setup

## Accepted Cost Boundary

Module 2 uses two separate website-restricted browser keys:

- **Maps Embed API** for directions previews. Google currently documents Embed
  as no-charge with unlimited requests.
- **Maps JavaScript API + Places API (New) + Geocoding API** for confirmed
  Malaysia-only Autocomplete suggestions and one-shot current-location reverse
  geocoding. The app uses the Autocomplete Data API and does not request Place
  Details or create a Dynamic Maps instance.

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
8. Configure separate daily hard quotas of **250 requests** for Autocomplete
   Requests and Geocoding. Disable automatic quota increases. If Cloud Console
   does not expose an enforceable hard daily quota for either service, do not
   put the location key into the production environment.
9. Configure 50%, 75%, and 90% quota alerts for both services and a low
   project-level billing budget alert. Alerts are notifications and do not stop
   requests; the hard quota is the production cost boundary.
10. Put both keys in the ignored `.env.local` file:

```text
VITE_GOOGLE_MAPS_EMBED_API_KEY=your_restricted_browser_key
VITE_GOOGLE_MAPS_PLACES_API_KEY=your_restricted_location_key
```

11. Restart Vite after changing the environment file.

Vite browser variables are visible to users by design, so website and API
restrictions are the actual security boundary. Never commit `.env.local`.

## Server Routes Deployment Gate

This section describes required deployment configuration; it has not been
performed by this repository change.

1. Create a dedicated key named `lets-tumpang-server-routes`. Never put it in a
   `VITE_` variable or browser bundle.
2. Restrict the key to **Routes API only** and apply the strongest supported
   server/application restriction for the chosen Edge runtime.
3. Configure a hard Routes limit of **250 requests per Malaysia calendar day**,
   disable automatic quota increases, and configure 50%, 75%, and 90% alerts.
   If Google Cloud does not expose an enforceable daily cap for this project,
   leave route publishing undeployed; alerts alone are insufficient.
4. Set Edge secrets `GOOGLE_ROUTES_SERVER_KEY`, `M2_ROUTE_QUOTE_SECRET` (at
   least 32 random characters), `M2_ROUTE_BACKFILL_SECRET` (at least 32 random
   characters), and `M2_ALLOWED_ORIGIN`.
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
- Choosing “Use current location” reuses an accurate entry reading where
  possible. Accuracy over 100 metres is rejected before Geocoding; accepted
  candidates use exactly one reverse-geocoding request and require driver
  confirmation.
- Automated tests mock Google and browser geolocation. They must make zero real
  API calls.
- If the location key is absent, offline, or over quota, existing Ride text and
  Embed previews remain readable, but a new unconfirmed location cannot be
  saved. If the Embed key is absent, the local route illustration remains.
- The local, undeployed Edge Function calls Routes API with traffic-aware
  routing only during Review/Publish or the bounded backfill. The server key is
  never returned to the browser. Quote tokens expire after five minutes and are
  encrypted plus HMAC-signed so private route anchors are not exposed.

## Controlled Smoke Test

Run this only after both hard quotas and alerts are visible in Cloud Console:

1. Record Autocomplete and Geocoding usage before the test.
2. Select one pickup and one destination from Google suggestions.
3. Resolve and confirm current pickup once with browser geolocation.
4. Confirm the counters increased only for the expected Autocomplete and
   Geocoding SKUs and that Routes usage remains zero.
5. Do not repeat the smoke test merely to exercise UI states; use mocks for all
   regression and responsive tests.
