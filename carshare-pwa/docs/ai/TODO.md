# TODO.md

Project-level coordination only. Module work belongs in `docs/ai/modules/Mx_*.md`.

## NOW
- [x] Inspect the real GitHub repository and branch structure.
- [x] Define shared-core + per-module AI context architecture.
- [x] Align AI context with Codex + Claude Code and Karpathy 4 Rules.
- [ ] Add this V1.1 context package to a Git branch and review through PR.
- [ ] Confirm which existing module branches continue and which should be refreshed from `Development`.
- [ ] Review `Development` as the integration baseline before new feature work.
- [x] Replace Module 2 route placeholders with a zero-charge Google Maps Embed integration and local fallback.
- [x] Remove stale OpenStreetMap tile-cache assumptions from the PWA configuration.

## READY FOR OTHER MODULES TO USE

Module 6 now serves place data so Modules 2 and 4 do not have to build or
maintain a catalogue of their own. Both are callable today against the fixture
catalogue and need no API key, no Supabase deployment, and no work from Brayden
first. Import from `src/business-logic/discovery/PlaceQueryService.js`.

- **Module 4 (FR-4.1, FR-4.2)** — `queryPlacesNearPoint({ lat, lng, radiusKm, category })`
  returns places within a radius, nearest first, for landmark-proximity filtering
  and transfer-point selection.
- **Module 2 (FR-2.15, FR-2.16)** — `queryPlacesAlongRoute({ origin, destination, corridorWidthKm, category })`
  returns places inside a corridor of the route, **ordered by position along it**
  rather than by distance, so a Host sees stops in the order they will pass them.

Both return the same narrow shape - `placeId, sourcePlaceId, name, category, lat,
lng, state, rating, reviewCount, photoReference` - and exclude Retired places, so
neither caller has to know Module 6's internals or remember a withholding rule.
When the live catalogue replaces the fixture, this contract does not change.

Please tell Brayden if the shape or the ordering does not suit your screen; it is
easier to change now than after you have built against it.

## NEXT
- [ ] Update module file maps during each module's next task.
- [ ] Review CI branch names because the workflow references `dev` while the repository uses `Development`.
- [ ] Enable Maps Embed API only in `my-project-cd-505310` and create a website/API-restricted key.
- [ ] Add the final HTTPS deployment referrer to the restricted Maps Embed key.
- [ ] Decide the next integrated vertical slice based on current code.
- [ ] **Module 6 Google Cloud work (Brayden).** Everything needed is written up request by request in `docs/MODULE6-API-SETUP.md`: a third **server-side** key, four SKUs to authorise, and the daily hard quotas to set. Nothing in the module needs it to run, test, or demo today - `/discover` works offline on its fixture catalogue - so this is scheduling rather than a blocker.
- [ ] Deploy `024_m6_destination_discovery.sql`. It needs Dashboard SQL Editor access; the publishable key cannot create tables.
- [ ] Wire Module 6's prefill payload into Module 2's publish form and Module 4's search form (FR-6.35). `DestinationDiscoveryService.buildPrefillPayload()` already returns it; the two forms do not read it yet, so "I will drive" currently opens an empty form. Needs a short agreement with Yee and Eizen on how each form accepts an incoming destination.

## BLOCKED / NEEDS TEAM CONFIRMATION
- Long-lived Module1–Module6 branches vs gradually moving to short-lived feature branches.
- Several existing module branches are behind current `Development`.
- Google Cloud Console setup remains unverified until the restricted Embed-only key is created. Billable Maps SKUs stay disabled except the Module 6 catalogue SKUs accepted in D018.
- D018 needs Console work before Module 6 ingestion can run against live data: authorise Nearby/Text Search, Place Details and Place Photos, and create a **server-side** key (the two existing keys are website-restricted and unusable from an Edge Function). Store it as a Supabase secret with no `VITE_` prefix. Full request-by-request specification, including the field-mask tiers that decide the bill, is in `docs/MODULE6-API-SETUP.md`.
- No `.env` or `.env.local` exists in this working copy, so `isSupabaseConfigured` is false and every module falls back to its mock adapter. Anyone who needs to work against the live project must copy `.env.example` themselves; "Supabase is connected" is true of the shared project, not of a fresh checkout.
- Module 6 caches Google place content that the Maps Platform terms say should not be stored (D018). Accepted as a prototype limitation; it must appear in the report's limitations section.
- `/discover` is public under D017, but `024`'s `places` policy grants SELECT to `authenticated` only. That is consistent today because the screen runs on the local fixture catalogue, but once `024` is deployed and Supabase becomes the source, a signed-out visitor would see an empty catalogue. Granting `anon` read on `places` needs the same explicit public-payload approval D017 requires - it has deliberately not been added unilaterally.
- Google OAuth (D015): code is in place, but someone with Supabase Dashboard + Google Cloud Console access still needs to register the OAuth Client ID/Secret and enable the provider - see `docs/SUPABASE-SETUP.md`. Cannot demo "Continue with Google" against the live project until that's done.
