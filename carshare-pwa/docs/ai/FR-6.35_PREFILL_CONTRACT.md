# FR-6.35 Destination Prefill Contract

**Status:** Accepted (D019; URL transport amended 2026-08-20)

This is the shared handoff contract between Module 6 (Destination Discovery),
Module 2 (Ride Sharing Management), and Module 4 (Smart Search & Favourite).
It prevents users from retyping a destination they selected in Module 6.

## Purpose and transport

Module 6 produces optional query parameters through
`DestinationDiscoveryService.buildPrefillUrl()`. Query strings are deliberate:
they survive reloads, bookmarks, and authentication without shared in-memory
state. No handoff value is persisted automatically.

```text
Module 6 destination detail
  -> Module 4 Search: /search?pickup&destination&date&destinationPlaceId
  -> Module 2 Publish: /ride/publish?destination&date
```

Every parameter is optional. With no usable values, each producer returns the
bare route and each consumer preserves its normal defaults.

## Module 4 Search parameters

| Parameter | Meaning |
|---|---|
| `pickup` | Display text for the traveller's selected origin. |
| `destination` | Display text for the selected destination. |
| `date` | Optional `YYYY-MM-DD` travel date. |
| `destinationPlaceId` | Opaque Module 6 catalogue/source hint for future search correlation. |

`destinationPlaceId` is not a confirmed Ride Place ID. Fixture values such as
`fixture_jonker` may be carried because Search treats the value as opaque, but
they must never become a confirmed Google location, expose private Ride fields,
or be persisted to a Ride.

Module 4 reads these values through its normal URL criteria parser. Search
criteria remain editable, shareable, and synchronized with the complete Search
URL. Invalid dates are handled by the existing Smart Search validation rather
than weakening or bypassing it.

## Module 2 Publish parameters

| Parameter | Meaning |
|---|---|
| `destination` | Display text used to pre-fill the destination field. |
| `date` | Optional `YYYY-MM-DD` departure date. |

Module 6 does not assume that a traveller's current origin is the Host's pickup
point. Module 2 therefore receives only destination and date. Incoming display
text remains unconfirmed until the Host selects a valid Malaysia-only Google
location through the existing input. The handoff never supplies or fabricates a
Place ID, coordinates, device location, or private pickup instructions.

## Producer rules

Module 6 must:

1. Record weak interest before navigating away from a selected destination.
2. Build both links through `buildPrefillUrl(target, place, options)`.
3. URL-encode every value through `URLSearchParams`.
4. Send Search to `/search`, never to the personal `/ride` workspace.
5. Record strong intent only for `I will drive` or notification registration.

## Compatibility and safety

- Legacy `/ride?from=...&to=...&date=...` links are replaced with the canonical
  `/search?pickup=...&destination=...&date=...` URL before authentication is
  considered. Ordinary bare `/ride` visits still open the authenticated My
  rides workspace.
- Consumers ignore missing and unrelated parameters and preserve normal screen
  behaviour.
- Query values are untrusted input. They do not bypass date validation,
  Published/seat-availability filtering, authentication, RLS, or confirmed
  location rules.
- Search URL state contains only public criteria. Place IDs, precise Ride
  coordinates, pickup instructions, and other private Ride fields are never
  introduced by this contract.
- Renaming a parameter or changing its meaning requires a coordinated update to
  Modules 2, 4, and 6 plus D019.

## Acceptance checks

- Module 6 `Find a ride` opens `/search` with origin, destination, date, and the
  opaque destination hint pre-filled when supplied.
- Module 6 `I will drive` opens `/ride/publish` with destination and date
  pre-filled but unconfirmed.
- Direct `/search`, `/ride`, and `/ride/publish` visits retain their normal
  behaviour.
- Reloading or sharing a generated URL retains its prefill.
- Legacy Ride search links reach Module 4 without losing encoded values.
