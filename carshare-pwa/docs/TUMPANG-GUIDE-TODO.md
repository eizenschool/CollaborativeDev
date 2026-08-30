# Tumpang Guide — deployment and verification TODO

This is Module 6-local coordination. It intentionally does not modify the
team-wide `docs/ai/TODO.md` before review.

## Implemented in this branch

- [x] Public rollout-gated `/assistant` route without an eighth main-nav item.
- [x] Four-language controlled intent, one-question clarification and speech transcript input.
- [x] Database-only three-role recommendations with strict Place ID/evidence/action validation.
- [x] Existing weather, season, destination score, Trip History, Ride seat and FR-6.35 handoff reuse.
- [x] Confirmed low-risk actions and fixed emergency flow.
- [x] Clearly-labelled rules fallback for offline/provider failure, plus QA date/weather/latency/fallback/injection controls.
- [x] Signed-in 90-day history, feedback, RLS, quotas, private traces and retention SQL.
- [x] Help pgvector schema, four-language seed content and keyword fallback.
- [x] Existing ingestion Details field-mask extension with per-field provenance.
- [x] Weekly top-five catalogue request validation and notification contract.
- [x] Vitest, Edge-pure, SQL-contract and responsive/axe Playwright test files written.

## Required second checkpoint

- [ ] User switches model and explicitly authorises testing.
- [ ] Run targeted Module 6 tests with `npm.cmd exec vitest -- --config vitest.m6.config.js`.
- [ ] Run the complete Vitest suite.
- [ ] Run Tumpang Guide Playwright on phone, tablet and desktop projects.
- [ ] Run full Playwright only after targeted UI checks pass.
- [ ] Run `npm.cmd run build` and `npm.cmd run build:fixture` to verify production and PWA output.
- [ ] Inspect generated service-worker build for `/assistant` route assets and no secret leakage.

## Deployment (not performed here)

- [ ] Resolve the pre-existing duplicate `075_m3` / `075_m6` filename with the Module 3 owner; do not rewrite their file unilaterally.
- [ ] Review then apply `079_m6_tumpang_guide.sql`, followed by additive `080_m6_tumpang_guide_stability.sql`, in Supabase.
- [ ] Redeploy `m6-ingest` only after migration `079` exists.
- [ ] Deploy `m6-tumpang-guide` with Gemini server flag disabled.
- [ ] Configure allowed origins, visitor pepper, global caps and `GEMINI_API_KEY` Edge secret.
- [ ] Configure `M6_GUIDE_GEMINI_MODEL=gemini-3.5-flash-lite` and approved `M6_GUIDE_QA_USER_IDS`.
- [ ] Populate the 16 Help embeddings through the server-only refresh operation.
- [ ] Verify two-account RLS, one/all deletion and account cascade against a non-production test project.
- [ ] Verify weekly catalogue aggregation with dry run, then one low-risk test request.
- [ ] Enable rollout flags in order: QA → test accounts → signed-in users → guests.
- [ ] Verify `/assistant/qa` is available only in local development or to the approved production QA allowlist.

## Acceptance evidence to record

- [ ] 100% of shown Place IDs exist and are recommendable in red-team prompts.
- [ ] Unknown requested places produce catalogue request flow, never a recommendation.
- [ ] Trip History off/on/off changes only affinity and never sends identity/contact/coordinates.
- [ ] 5/20 successful-provider limits, burst/global caps, 10-second timeout, 429 and invalid JSON all degrade safely.
- [ ] Guests leave no session/message/feedback row.
- [ ] Help vector result and keyword fallback both cite only versioned Help rows.
- [ ] Retry Gemini, language switching, Why this and detail-page return preserve the same `batchId`.
- [ ] Home/Search UI and all former safety files remain byte-for-byte untouched.
