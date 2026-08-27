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

- **Module 4 (FR-4.1)** — now consumes
  `getPlaceBySourcePlaceId(sourcePlaceId)` and
  `queryPlacesNearPoint({ lat, lng, radiusKm, category })` for its 5/10/25 km
  confirmed-destination search. Fixture and live matching are ready;
  `035_m4_destination_proximity_search.sql` was deployed and verified on
  2026-08-20.
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
- [x] Reconcile tracked `057_m2_fix_family_link_crypto_schema.sql`, deploy
  `061_m2_sos_trusted_family.sql`, advisor follow-up `062`, and
  `notification-push` version 11, then run Supabase advisors.
- [ ] Keep `VITE_M2_SOS_ENABLED` off until the two-account/two-phone Trusted
  Family/SOS acceptance sequence passes. Netlify upload remains a separate
  release-owner step.
- [ ] Complete the documented two-account four-language/device-voice acceptance checks for deployed `036_m3_message_translation.sql` and active `m3-message-translation` version 2.
- [ ] Update module file maps during each module's next task.
- [ ] Review CI branch names because the workflow references `dev` while the repository uses `Development`.
- [ ] Enable Maps Embed API only in `my-project-cd-505310` and create a website/API-restricted key.
- [ ] Add the final HTTPS deployment referrer to the restricted Maps Embed key.
- [ ] Decide the next integrated vertical slice based on current code.
- [x] **Module 6 Google Cloud work (Brayden).** The server-side key exists, is stored as the Supabase secret `GOOGLE_PLACES_SERVER_KEY`, and has been exercised successfully against Nearby Search, Place Details, and Place Photos (real ingestion, not just a smoke test - see below). Street View is not yet exercised (FR-6.15 remains unimplemented). Whether true daily hard quotas are configured in the Google Cloud console, versus relying on manual per-call discipline, is unconfirmed either way - the persistent daily ledger below is still not built, so no server-side cap actually exists yet regardless of console settings.
- [x] Deploy `024_m6_destination_discovery.sql`. It is live as the Supabase migration `m6_destination_discovery`. The catalogue holds real Kuala Lumpur places; `anon` read is deployed and confirmed working (`029_m6_anon_place_browsing.sql` + `030_m6_anon_source_place_id.sql`, Dashboard SQL Editor), and the live-vs-fixture choice remains the `VITE_DISCOVERY_DATA_SOURCE` frontend switch.
- [x] Deploy the versioned `supabase/functions/m6-ingest/index.ts` Edge Function with Supabase secret-key authorization on `apikey`; live function `m6-ingest` is active and has ingested real data.
- [x] Create the third server-side Google key and store it as the Supabase secret `GOOGLE_PLACES_SERVER_KEY`. Whether the four documented hard quotas are actually set as console-enforced daily caps is unconfirmed - see the ledger item below.
- [x] Run ingestion against a single region (Kuala Lumpur) and verify the Google-side result. This went beyond a smoke test: 20 places were ingested (`discovered: 20, enriched: 15, upserted: 15` on the first pass; `refreshDetails: true` re-enriched all 20 for review storage on a second pass), classification and description bugs were found and fixed against the real data, and the results were confirmed in the Dashboard Table Editor.
- [ ] Add a persistent daily ingestion-budget ledger if the Google Maps quota page exposes only per-method/per-minute limits. Still not built; the only real budget control this session was manual per-call tracking during ingestion, not a database-enforced cap.
- [x] Agree and document the shared FR-6.35 payload contract for Modules 6, 2, and 4. See `docs/ai/FR-6.35_PREFILL_CONTRACT.md` and D019.
- [x] Wire FR-6.35 into Module 2's publish form and Module 4's Search URL. `buildPrefillUrl()` now targets canonical `/search` parameters for travellers and `/ride/publish` for Hosts without weakening Module 2's confirmed-location validation. D019 was amended to record the reload-safe URL contract.
- [x] Deploy and verify hardened `034_m4_smart_search_favourites.sql` and
  `035_m4_destination_proximity_search.sql`; authenticated favourite mutations,
  unavailable cards, and anonymous proximity search were live-verified on
  2026-08-20.
- [x] Review, then separately deploy and verify
  `039_m4_vehicle_language_filters.sql`. Until deployment, ordinary exact and
  proximity Search remain available; choosing vehicle or language reports the
  deployment dependency honestly.
- [x] Review and deploy `040_m4_favourites_advisor_followup.sql`, then rerun the
  performance advisor to clear the favourite ride foreign-key notice. The
  unused-index notice may remain until normal favourite traffic exercises the
  new table.
- [x] Deploy `067_m4_favourite_unavailable_notifications.sql`; unavailable saved
  rides now use the shared notification centre and Web Push path with a stable
  per-transition dedupe key and safe alternative-search deep link.
- [x] Deploy `068_m4_multi_leg_journey_search.sql`; Search falls back only after
  direct results are exhausted and returns public-safe two-leg itineraries over
  confirmed endpoints and approved catalogue transfer points.
- [ ] Complete final Module 4 two-account/device acceptance: owner compatibility
  edits, favourite isolation, one alert per availability transition, denied-push
  in-app fallback, and a live seeded direct/proximity/multi-leg matrix.
- [x] Deploy `041_m6_ride_available_notification.sql` (Module 6 becomes D020's
  second notification producer, after Message) and
  `042_m6_scheduled_ingestion.sql`, both live-verified 2026-08-24. Deploying
  `041` also surfaced that `033_project_notifications.sql` had never actually
  been applied to this environment despite being recorded as deployed - it was
  applied first, then `041`.
- [ ] Redeploy the `m6-ingest` Edge Function. `042`'s scheduled sweep found a
  real bug the same day: its FR-6.3/6.4/6.5 auto-decay step used an
  untrustworthy absence signal (Nearby Search's 20-result cap and narrow
  default type list would falsely demote real, quieter places), caught before
  any place was actually mis-demoted and removed from
  `supabase/functions/m6-ingest/index.ts`. The weekly cron job was unscheduled
  as a precaution and needs the fixed function redeployed, then
  re-scheduled by re-running `042`'s closing `cron.schedule(...)` block - see
  `docs/MODULE6-HANDOVER.md` §5/§8.

## BLOCKED / NEEDS TEAM CONFIRMATION
- Long-lived Module1–Module6 branches vs gradually moving to short-lived feature branches.
- Several existing module branches are behind current `Development`.
- Google Cloud Console setup remains unverified until the restricted Embed-only key is created. Billable Maps SKUs stay disabled except the Module 6 catalogue SKUs accepted in D018.
- D018 needs Console work before Module 6 ingestion can run against live data: authorise Nearby/Text Search, Place Details and Place Photos, and create a **server-side** key (the two existing keys are website-restricted and unusable from an Edge Function). Store it as a Supabase secret with no `VITE_` prefix. Full request-by-request specification, including the field-mask tiers that decide the bill, is in `docs/MODULE6-API-SETUP.md`.
- This working copy has an ignored `.env.local` connected to the live project.
  Fresh checkouts still require their own local configuration; the file and its
  browser-safe public credentials must never be committed.
- Module 6 caches Google place content that the Maps Platform terms say should not be stored (D018). Accepted as a prototype limitation; it must appear in the report's limitations section.
- Google OAuth (D015): code is in place, but someone with Supabase Dashboard + Google Cloud Console access still needs to register the OAuth Client ID/Secret and enable the provider - see `docs/SUPABASE-SETUP.md`. Cannot demo "Continue with Google" against the live project until that's done.
