# Module 2 content moderation release

Status: production moderation deployed and enabled on 2026-09-17. SQL 114 is
live as `20260917091148_m2_content_moderation_v4`; `m2-content-check`,
`m2-content-cleanup`, and the matching `m2-route-quote` are active. The matching
SQL 115 cleanup schedule is live as
`20260917101615_m2_content_cleanup_schedule`; its hourly job is active and its
first verified invocation returned HTTP 200 with `removed: 0`. The matching
Netlify frontend asset `assets/index-wdETJdRQ.js` was verified live before the
text/photo flags were enabled. The final `m2-content-v4` run PASSED all
120 live cases: all 64 safe cases approved, all 56 high-risk cases rejected, each
language group had 0% false positives, and no outcome was unavailable. Results:
`docs/ai/evidence/m2-moderation-20260917-v4-results.json`; reproduce with
`node scripts/evaluate-m2-moderation.mjs --results <that-file>` (exit 0).

The first v1 run failed because `mixed-12`, a warning not to share identity
numbers, was rejected (6.25% mixed-language false positives). Its preserved result
is `docs/ai/evidence/m2-moderation-20260917-results.json`. Subsequent runs exposed
one transient unavailable result and occasional model-only high-risk misses, so v4
adds narrow multilingual high-confidence backend rules before Qwen. The temporary
evaluator was removed after evidence was recorded.

During Dashboard automation, the built-in Supabase secret key was displayed in
the local task transcript. The user explicitly stopped the proposed rotation and
accepted continuing deployment with the existing key; the separately created
`app_backend_20260917` key remains unused. No secret was written into repository
files or evidence artifacts.
The Cloudflare account owner confirmed on 2026-09-17 that the account uses the
Free plan. Remaining daily allowance is still runtime-dependent and continues to
fail closed when exhausted.
Preserve the unrelated in-progress Module 1 SQL 113 work.

## Verified read-only preflight (2026-09-17)

- Linked project: `pnetstmovctfwqcumodx`.
- `m1-avatar-content-check` active version 12 uses Sightengine; its policy stays
  fail-open. M2 opts into strict response validation and fails closed.
- `m3-message-translation` already calls Cloudflare Workers AI using
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN`; both secret names exist.
  `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` names also exist.
- `persist_quoted_ride` is service-only; `set_ride_pickup_photo` currently permits
  authenticated calls. SQL 114 revokes that browser binding path and blocks direct
  browser insertion, replacement and deletion in the pickup-photo bucket.
- pgcrypto, pg_cron, pg_net and Supabase Vault are present. Existing Cloudflare
  token permission was proven by the live evaluation, and the account owner
  confirmed Workers Free. Translation/transcription and moderation share the
  daily account allowance.

## Acceptance first (separate deployment approval)

1. Confirm Workers Free with the account owner; do not enable Workers Paid or a
   paid fallback. A new token in the same account does not isolate allowance.
2. Deploy ONLY `m2-content-evaluate` with its shared policy/corpus dependencies.
   It has manual server-credential authentication (`verify_jwt=false`), accepting
   the Dashboard's built-in secret `apikey` or matching server Bearer key; no public
   caller can use it as an AI proxy. It accepts only fixed synthetic case IDs,
   never arbitrary text. It changes no database rows or production flags.
3. Use the Supabase Dashboard function tester with the server/service role
   authorization, or an already-authorized server runner. POST `{}` lists case
   IDs. POST `{"caseId":"en-01"}` evaluates one. Run all `en-01..30`, `zh-01..30`,
   `ms-01..30`, `mixed-01..30` sequentially; stop on unavailable/quota errors.
   Never paste/export the service credential or Cloudflare token into chat.
4. Export only the result objects (no credentials) to a local JSON array and run
   `node scripts/evaluate-m2-moderation.mjs --results <file>` to produce the gate
   report. Alternatively the same script can call Cloudflare locally only when
   credentials are already intentionally configured in a private local process.
5. Require all 120 results, all 56 rejected/high-risk examples blocked, no
   unavailable/malformed results, and at most 5% false positives separately per
   language. These are finite project acceptance tests, not a guarantee of legal
   compliance or detection of every harmful input. Human-review corpus labels.
6. Delete the temporary evaluator after recording the report. If it fails, leave
   production text moderation disabled and report the failed cases; do not relax
   the guard or fall back to Gemini.

## Coordinated production deployment

Prepare all changes first; deploy during a short publish/edit maintenance window.
Old clients will be rejected by the new database guard until refreshed.

1. Deploy `m2-content-check` and `m2-content-cleanup` with flags disabled. Their
   shared dependencies include `m2ContentPolicy.mjs`, `sightengineCheck.ts` and
   `m2Routes.ts`. The M1 provider compatibility re-export must ship with the shared
   file when M1 is next deployed; its behavior is unchanged.
2. Apply `114_m2_content_moderation.sql` as a new tracked migration, never edit
   existing history. Then deploy the updated `m2-route-quote` and frontend as one
   release. There is intentionally no unmoderated fallback during this window.
3. Following a passing evaluation, set server-only `M2_TEXT_MODERATION_ENABLED=true`,
   `M2_TEXT_EVALUATED_POLICY=m2-content-v4`, `M2_PHOTO_MODERATION_ENABLED=true`.
   Existing `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AI_TOKEN` are the defaults.
   Optional M2-specific account/token overrides must be configured as a pair.
   Reuse `M2_ALLOWED_ORIGIN`; include the actual production origin.
4. Configure a random `M2_CONTENT_CLEANUP_SECRET` on Edge and the same secret in
   Vault under `m2_content_cleanup_secret`. Store the full cleanup function URL in
   Vault as `m2_content_cleanup_url`; apply SQL 115 to schedule hourly cleanup.
   Do not put secret values into migrations, command arguments, logs or docs.
5. Verify live with synthetic content: valid new Ride, rejected text, rejected
   photo, photo removal, resumed Draft, Published edit, retry after outage, stale
   approval, other-owner attempt, accepted-request lock and guest photo visibility.
   Confirm M1 avatar behavior and M3 translation remain functional. Inspect only
   test records approved for this acceptance run and clean them up separately.

## Contracts and recovery

- Frontend sends image bytes to the authenticated moderation function, not
  directly to Storage. Approved bytes get an immutable private UUID path.
- Text approval is bound to Host, Ride, exact persisted text hashes, selected
  photo path, policy version and the Ride's `updated_at`. It expires in 15 minutes.
  Identical text may reuse a still-valid verdict; photos may reuse same-byte
  approvals less than 24 hours old. Changed content is never approved by a browser
  boolean. No user text/photo bodies are stored in moderation logs.
- `persist_moderated_ride(p_args jsonb,p_approval_id uuid)` locks the Ride and
  wraps the existing service-only route persister. Photo and ride changes commit
  together. Deferred database checks validate final content; stale/forged proofs
  roll back everything. Existing route, vehicle, identity and request rules remain
  in the original database paths. Normal lifecycle-only updates do not demand a
  new content check; historical rides are checked upon editing/republishing.
- Draft text is private and may be saved without a text verdict. Draft photos are
  checked before attachment. An optional photo is never silently dropped after
  rejection. First-time publishing creates a private Draft and keeps its ID for
  retry; failed edits retain the public version and local input.
- Unbound photos older than 24 hours are claimed for cleanup. Active receipt
  references protect in-flight submissions; retiring paths cannot be reused.
  Storage deletion uses the Storage API, not deletion of storage metadata.
- There is a server limit of 40 moderation requests/Host/hour. A new photo and
  the combined text check consume separate requests. Provider quota,
  timeouts and malformed results fail closed. Operational logs contain duration,
  outcome and fixed category/quota codes only.
- If a release fails, leave the guard in place and pause publishing/editing. Do
  not restore a frontend-only check or disable the guard to bypass an outage.

## Verification

Verified on 2026-09-17: 187 targeted tests, 18 isolated PostgreSQL checks,
4 phone/desktop browser tests, layer validation, production build and Deno checks
for all five affected Edge entrypoints passed. Browser outcomes include simulated
fixture coverage. The 120-case Cloudflare run passed and live database checks
confirmed the deferred guard is enabled, browser roles cannot read approvals,
insert approved-photo metadata, call the moderated persister, or use the legacy
photo-binding RPC, while `service_role` retains the required persister access.
User-led publish/edit/photo acceptance is pending. The hourly SQL 115 cleanup
schedule and its dedicated Edge/Vault secret pair are deployed; abandoned
moderated uploads older than the protected retention window are now removed
automatically when eligible.

Post-release client fix: when a newly selected photo is rejected or unavailable,
the client still runs the independent text review against the currently attached
photo and merges all field errors before returning to Trip Details. A photo error
therefore cannot hide contribution or pickup-instruction violations; persistence
remains blocked when any field fails.

- `npm test -- supabase/functions/m2-content-check supabase/functions/m1-avatar-content-check src/business-logic/m2-rides/__tests__ tests/contracts/m2 tests/integration/SupabaseIntegration.test.js`
- `npm run check:layers` and `npm run build`.
- `npm run test:e2e -- tests/e2e/m2-content-moderation.spec.js --project=phone-375x812 --project=desktop-1440x1024`.
  Browser tests inject provider outcomes using fixture services; they do not
  claim to measure live AI accuracy.
- `node scripts/test-m2-moderation-db.mjs` executes SQL 114 and the existing real
  route persister in isolated PostgreSQL/WASM. Install the optional test runtime
  only in ignored `m2-test-runtime.local` as documented by that script. Route helper
  dependencies are stubs, so this does not replace live Supabase RLS acceptance.
- Deno check the changed Edge entrypoints with `--no-lock --node-modules-dir=none`.
