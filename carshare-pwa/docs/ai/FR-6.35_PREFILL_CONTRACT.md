# FR-6.35 Destination Prefill Contract

**Status:** Accepted (D019)

This is the shared handoff contract between Module 6 (Destination Discovery),
Module 2 (Ride Sharing Management), and Module 4 (Smart Search & Favourite).
It is the single source of truth for the destination selected in Module 6 and
the origin/destination values carried into the ride screens.

## Purpose

FR-6.35 means that a user does not retype a destination they have just selected:

```text
Module 6 destination detail
  -> Module 4 search: pre-fill from, to, and travel date
  -> Module 2 publish: pre-fill pickup, destination, and travel date
```

This is a navigation handoff only. It does not publish a ride, join a ride,
create a Google Place, or bypass the confirmed-location rules owned by Module 2.

## Transport and version

The payload is carried in React Router navigation state under the
`discoveryPrefill` key. It must not be placed in the URL or persisted in the
database. The current contract version is `1`.

```js
{
  discoveryPrefill: {
    version: 1,
    source: 'module6',
    travelDate: 'YYYY-MM-DD' || null,
    origin: {
      label: string,
      location: LocationReference || null
    },
    destination: {
      label: string,
      location: LocationReference || null,
      cataloguePlaceId: string || null
    }
  }
}
```

`travelDate` may be `null` when the discovery screen has no selected travel
window. A consumer must ignore an unknown version or an invalid payload and
fall back to its normal empty/default form.

## Field rules

| Field | Required | Meaning |
|---|---:|---|
| `version` | yes | Contract version. Unknown versions are ignored. |
| `source` | yes | Must be `module6`. |
| `travelDate` | no | ISO calendar date used to pre-fill the date controls. |
| `origin.label` | yes | Display text for the selected origin/pickup. |
| `origin.location` | no | Confirmed place/device reference. `null` means label-only and requires confirmation in Module 2. |
| `destination.label` | yes | Display text for the selected destination. |
| `destination.location` | no | A real confirmed Google Place reference only; fixture IDs must not be placed here. |
| `destination.cataloguePlaceId` | no | Module 6's internal catalogue key. Consumers must not persist it as a Ride Place ID. |

## Location references

A `LocationReference` has this shape:

```js
{
  source: 'place' | 'device',
  placeId: string,
  latitude: number || null,
  longitude: number || null,
  accuracy: number || null
}
```

Rules:

- `source: 'place'` is a confirmed Google selection and requires a non-empty
  real Google Place ID.
- `source: 'device'` is allowed only for a confirmed current-location pickup;
  it requires coordinates and an accuracy of 100 metres or better. This form is
  valid for `origin`, never for `destination`.
- A Module 6 fixture key such as `fixture_jonker` is a
  `destination.cataloguePlaceId`, not a confirmed `destination.location.placeId`.
- A label without a valid location reference is display text only. Module 2
  must keep the location unconfirmed until the Host selects a valid suggestion
  or confirms an eligible current-location result.

## Producer: Module 6

Module 6 must:

1. Record interest before handing the user to another module.
2. Build the payload from the selected place, the current discovery origin, and
   the selected travel date.
3. Use the same payload shape for both actions:

```js
navigate('/search', { state: { discoveryPrefill: payload } });
navigate('/ride/publish', { state: { discoveryPrefill: payload } });
```

4. Put a real Google Place ID in `destination.location` only when the catalogue
   record actually contains one. Fixture records remain label-only references.
5. Record strong intent only for `I will drive` or `Tell me when there is a
   ride`; opening or viewing a destination remains weak interest.

## Consumer: Module 2

`PublishRide` must read and validate `location.state.discoveryPrefill` once on
entry.

- Pre-fill `form.destination` from `destination.label`.
- Pre-fill `form.destinationLocation` only from a valid
  `destination.location`; otherwise leave it `null` and require confirmation.
- Pre-fill `form.pickup` from `origin.label`.
- Pre-fill `form.pickupLocation` only from a valid `origin.location`.
- Pre-fill `form.date` from `travelDate` when present; do not invent a date.
- Preserve the existing vehicle gate, Malaysia-only suggestion rules, current
  location accuracy rule, and final confirmed-location validation.
- With no payload, initialise the existing empty form unchanged.

The handoff never writes `cataloguePlaceId` into the Ride row. The Ride service
continues to persist only the canonical route fields it already owns.

## Consumer: Module 4

The real search screen must read and validate the same state object.

- Pre-fill `from` from `origin.label`.
- Pre-fill `to` from `destination.label`.
- Pre-fill `date` from `travelDate` when present.
- Keep any location references available for future proximity/route filtering,
  but do not require them for the current text-based search fixture.
- With no payload, preserve the existing search defaults.

The `/search` route must render the search module before this handoff can be
demonstrated end to end. A placeholder route is not considered FR-6.35 support.

## Validation and compatibility

All three modules must treat the payload as untrusted input even though it is
passed through in-app navigation state:

- reject blank labels, invalid dates, invalid coordinates, and unknown versions;
- ignore extra fields rather than failing;
- never turn a fixture catalogue key into a confirmed Google Place ID;
- keep the normal screen behaviour when the state is absent, stale, or invalid.

Additive optional fields may remain on version `1`. Renaming a field, changing
its meaning, or changing confirmation semantics requires a new version and a
coordinated update by all three module owners.

## Acceptance checks

- Selecting a destination in Module 6 and choosing `Find a ride` opens Module 4
  with origin, destination, and date pre-filled.
- Selecting an unserved destination and choosing `I will drive` opens Module 2
  with the same values pre-filled.
- A fixture destination is visibly pre-filled but remains unconfirmed in Module
  2 until the Host selects a valid location.
- Direct visits to `/search` and `/ride/publish` still behave as before.
- Invalid or missing navigation state does not break either form.
