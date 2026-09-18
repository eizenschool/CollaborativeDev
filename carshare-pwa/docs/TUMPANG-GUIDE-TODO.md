# Tumpang Guide — takeover checklist

Updated: 2026-09-02

Use `docs/TUMPANG-GUIDE-CLAUDE-HANDOFF.md` for context and
`docs/TUMPANG-GUIDE.md` for the canonical target contract.

## State already reported

- [x] User authorized implementation and later authorized testing.
- [x] User reports migration 081 was applied.
- [x] User reports earlier frontend/Edge deployments were performed.
- [x] Latest local Edge identifier is `m6-guide-agent-v3.1.1-2026-09-01.3`.
- [x] Latest local focused route/speech tests passed: 12.
- [x] Latest Module 6 Vitest run passed: 22 files / 129 tests.
- [x] Latest full Vitest run passed: 94 files / 1068 tests.
- [x] Latest targeted Guide Playwright passed: 12/12 responsive cases.
- [x] Production and fixture/PWA builds passed.
- [x] Latest `git diff --check` had only line-ending warnings.

These checks do not mean production is accepted. The user has observed failures
after earlier green test runs.

## Claude Code first checkpoint — audit before editing

- [ ] Read the takeover handoff and inspect the dirty worktree without resetting it.
- [ ] Map the real request pipeline and identify every place where provider
  ownership is split across intent, rendering, translation or grounded search.
- [ ] Verify remote migration 079/080/081 state and required service-role RPCs.
- [ ] Verify deployed frontend build/PWA cache and deployed Edge `edgeVersion`.
- [ ] Reproduce a failing turn and correlate `clientTurnId`, `traceId`, response
  header and private provider-attempt records.
- [ ] Confirm with the user before any architectural change that alters the
  canonical contract.

## Known unresolved or unverified items

- [ ] Prove Gemini failure causes a complete Groq replay from pre-turn state.
- [ ] Remove any remaining Gemini-intent/Groq-render or mixed search ownership.
- [ ] Prove provider cooldown does not leave all accounts blocked after one user’s
  429/contract failure.
- [ ] Prove named catalogue questions cannot enter recommendation clarification.
- [ ] Prove explicit KL recommendation language cannot reuse stale Melaka origin.
- [ ] Prove complete planning sentences cannot become `catalogue_missing`.
- [ ] Validate browser speech on real Chrome/Edge hardware in English, Chinese,
  Malay and Tamil, including pauses and manual Stop.
- [ ] Validate no duplicate speech insertion across recognizer restarts.
- [ ] Verify Starting point autocomplete and all composer controls at 320–480 px.
- [ ] Verify Past Plans deletion clears the active conversation immediately.
- [ ] Verify Discover return restores chat scroll without reload.
- [ ] Re-run the complete Playwright suite and triage every failure rather than
  dismissing it as unrelated.

## Policy acceptance

- [ ] Every recommendation ID exists in the recommendable catalogue.
- [ ] Coordinates enforce 80 km; label-only plans enforce same state.
- [ ] Local shortages return fewer cards instead of remote filler.
- [ ] Unknown places return fixed localized `catalogue_missing` with no provider
  request, sources, cards, actions, cache write or smart-turn consumption.
- [ ] `What is fun at KL Bird Park?` produces place information with no origin,
  date or party question.
- [ ] `我爱你` is ordinary chat only.
- [ ] `这个助手怎么用？` explains actual capabilities without Help refusal.
- [ ] “Help me save this” does not trigger SOS.
- [ ] Explicit unconsciousness/immediate danger returns fixed 999/Trusted Family
  in the message language and no turn counter.
- [ ] Signed-in users are unlimited; provider/project limits are shown as service
  reliability errors, not user allowance.
- [ ] UI language changes only explicitly; response language follows each message.

## Live test matrix

- [ ] Fresh anonymous and signed-in sessions.
- [ ] KL Bird Park direct question and detailed follow-up.
- [ ] Tokyo Disneyland refusal in English and Chinese.
- [ ] Melaka culinary 12-person local recommendation.
- [ ] KL recommendation after a Melaka-focused conversation.
- [ ] “Too far”, “another”, “quieter” refinements.
- [ ] Gemini success, Gemini 429/timeout to Groq success, and both-provider failure.
- [ ] Duplicate concurrent `clientTurnId`.
- [ ] Save/alert confirmation then persistence verification.
- [ ] Browser voice phrases: `test`, `KL Bird Park`, `测试`, one Malay sentence,
  one Tamil sentence.
- [ ] Starting-point `me` autocomplete, mobile layout, Discover return and Past
  Plans deletion.

## Before deployment

- [ ] Stop and obtain explicit deployment authorization.
- [ ] Review the complete diff, especially untracked Guide and migration files.
- [ ] Confirm no browser bundle contains provider/service-role secrets.
- [ ] Re-run Supabase security/advisor checks if SQL or privileged functions change.
- [ ] Record expected frontend build and Edge version.

## Deployment verification

- [ ] Apply only reviewed, unapplied migrations; do not reapply 081 blindly.
- [ ] Deploy Edge and frontend in the agreed order.
- [ ] Clear/update the PWA service worker and confirm the browser loads the new build.
- [ ] Confirm `x-tumpang-guide-version`, response `edgeVersion` and trace logging.
- [ ] Run the live test matrix and capture failures by trace ID.
- [ ] Stop before commit/push unless explicitly authorized.

## Findings from the 2026-09-03 live weather/route session

Recorded from a real transcript (`明天的馬六甲天氣如何` → route → recommend →
route again), then reopened from Past Plans. Weather itself is now correct;
these are what the same session exposed.

### Fixed in this pass

- [x] **Restored history showed different assistant text than the live chat.**
  `localizeGuideResponse` (`GuideResponseLocalization.js`) replaced a stored
  `clarify`/`recommend` message with canned copy whenever the response was not
  AI-authored (`source:"rules"`) or its language differed from the currently
  selected UI language. It runs only on the restore paths
  (`TumpangGuidePage.jsx::localizeStoredMessages`, lines ~457/474/525), never on
  the live turn — which is exactly why the same conversation read correctly
  while live and wrongly after reopening. `travel_info` survived intact only
  because it had no branch in that function at all. Fixed: cached translation →
  the stored message verbatim → canned copy only when there is no text at all,
  plus a real `travel_info` branch.
- [x] **`quickReplies` was never rendered.** The server had been sending
  clarify options since the first clarify branch existed; no component read
  them, so every "which place?" question arrived with its answers stripped.
  Now rendered as chips on the newest assistant message only.

- [x] **City route destinations.** `resolveMalaysianCity` now runs before
  catalogue matching in the route branch, mirroring the weather branch, and the
  routing prompt tells the model a city destination is a normal answer.
- [x] **Clarifying questions say what they accept.** Weather and route clarify
  copy now name the acceptable form (town/city as well as a specific venue),
  and an unresolvable destination is explained as "I could not place this on
  the map" with a suggestion, instead of a catalogue rule.

- [x] **Town-level geocoding, free.** `geocodeMalaysianPlace()` calls
  Open-Meteo's keyless geocoding service - the same provider as the forecast,
  so no cost and no new vendor - as the last resolution tier in both the
  weather and route branches. Resolution is now: focused catalogue venue →
  offline city/alias table → catalogue match → city named inside a phrase →
  Open-Meteo geocoding → honest default. It is town/city level only; a mall or
  a single landmark would still need a paid Google lookup, which is why the
  routing prompt asks the model to normalise a landmark down to its city.

### Open — needs a product decision

- [ ] **Hand off to Module 2's page instead of answering in chat?** Verified:
  the Guide already reuses Module 2's code, not a rebuild - `computeRoute` from
  `_shared/m2Routes.ts` and the shared `consume_m2_route_quota`, plus the same
  `ConfirmedLocationInput` component and `getCurrentLocationPreview()` that
  PublishRide/EditRide use. The remaining open question is a product one: keep
  answering the travel time inside the chat, or render an action that opens
  Module 2's route/ride page prefilled with origin + destination.
- [ ] **Routes are still kill-switched.** `M6_GUIDE_ROUTES_ENABLED` is unset and
  migration `082` is unapplied, so every route answer degrades to straight-line
  ("Rules fallback · routes unconfigured"). Phase 8 steps 2–3.

