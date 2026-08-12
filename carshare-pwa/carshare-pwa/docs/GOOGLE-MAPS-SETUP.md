# Google Maps Setup

## Accepted Cost Boundary

The current integration uses only **Maps Embed API** directions mode. Google
currently documents this API as no-charge with unlimited requests. It accepts
text origins, destinations, and up to 20 waypoints, which covers Module 2's
current route-preview requirement without enabling a billable Maps SKU.

Do not enable or add Maps JavaScript API, Places API, Routes API, Geocoding API,
Dynamic Maps, or Street View as part of this setup. Those products have separate
billable SKUs and may charge after their monthly free usage cap.

Official references:

- https://developers.google.com/maps/documentation/embed/usage-and-billing
- https://developers.google.com/maps/documentation/embed/embedding-map
- https://developers.google.com/maps/api-security-best-practices

## Cloud Project

```text
Project ID: my-project-cd-505310
API service: maps-embed-backend.googleapis.com
```

The owning Google account is intentionally not recorded in the repository.

## Safe Console Setup

1. Select project `my-project-cd-505310` in Google Cloud Console.
2. Confirm its billing account is the intended free-trial account. Maps Embed
   still requires billing to be enabled even though its requests are no-charge.
3. Enable **Maps Embed API only**.
4. Create a dedicated API key named `lets-tumpang-web-embed`.
5. Set Application restrictions to **Websites** and allow only:
   - `http://localhost:5173/*`
   - the final HTTPS deployment domain, once known.
6. Set API restrictions to **Restrict key**, selecting only **Maps Embed API**.
7. Put the key in the ignored `.env.local` file:

```text
VITE_GOOGLE_MAPS_EMBED_API_KEY=your_restricted_browser_key
```

8. Restart Vite after changing the environment file.

Vite browser variables are visible to users by design, so website and API
restrictions are the actual security boundary. Never commit `.env.local`.

## Cost Safety

- The application has no code path for paid Maps APIs.
- If the Embed key is absent, the existing local route illustration remains.
- The dedicated key must not authorize any API except Maps Embed API.
- Google Cloud alerts are useful notifications but should not be treated as a
  guaranteed Maps spending stop. Current spend-cap enforcement does not list
  Google Maps Platform as an eligible service.
- Any future autocomplete, geocoding, traffic, distance, or route-computation
  feature requires a separate explicit decision and quota/cost review first.
