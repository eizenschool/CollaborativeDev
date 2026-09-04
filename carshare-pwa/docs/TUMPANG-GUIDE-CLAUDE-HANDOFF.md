# Tumpang Guide — Claude Code takeover handoff

Updated: 2026-09-02

This is the single entry point for continuing Tumpang Guide work. It separates
the user's product decisions from what the current code merely appears to do,
and from what has actually been verified. Read this before editing code.

## 1. Why this handoff exists

The Guide has been changed repeatedly in response to live failures. Several
generations of design now coexist in code and older documentation. Passing unit
tests has repeatedly failed to predict production behaviour. Do not assume the
current architecture is correct because a test is green.

The user is explicitly asking for a careful audit and a reliable product, not
another isolated prompt patch. Challenge implementation assumptions, but confirm
material product changes with the user before coding.

## 2. Current confidence and deployment state

| Item | Current knowledge |
| --- | --- |
| Authoritative checkout | `C:/Users/SCSM11/Desktop/CD_Assignment/CollaborativeDev/carshare-pwa` |
| Local Edge version | `m6-guide-agent-v3.1.1-2026-09-01.3` in `supabase/functions/m6-tumpang-guide/index.ts` |
| Migration 081 | User reports it was applied. Verify the remote migration ledger and RPC/table availability. |
| Edge/frontend deployment | User reports earlier deployments. The latest local speech, responsive UI and recommendation-route edits were not deployed in the last completed work session. |
| Last observed remote version | An earlier smoke test saw an older `.2` Edge response while local was `.3`. This is historical evidence only; re-check before diagnosing. |
| Working tree | Intentionally dirty, with many modified and untracked Guide files. Preserve all work; do not reset or delete it. |
| Product status | Not accepted. The user still observes routing, provider availability, speech and UI failures. |

Before any live diagnosis, record all four of these together:

1. frontend commit/build identifier and service-worker state;
2. response header `x-tumpang-guide-version`;
3. response JSON `edgeVersion` and `traceId`;
4. Supabase migration ledger plus matching private provider-attempt rows.

Without that evidence it is easy to debug stale frontend code against stale Edge
code and draw the wrong conclusion.

## 3. User-approved product contract

### AI ownership

- Gemini is primary and owns an entire turn: understanding, tool selection and final answer.
- If any Gemini stage fails, discard the whole Gemini attempt. Groq must replay
  the turn from the original message and pre-turn state.
- Never combine Gemini intent with Groq rendering, translation or search.
- Provider names and internal failure chains are private audit data, not normal UI.
- Online conversation should be AI-understood. Deterministic rules protect hard
  boundaries; they must not become the normal conversational engine.
- Offline fallback must be visibly identified as offline and must not pretend to
  be an AI answer.

Important audit warning: the current `index.ts`, `providers.ts` and
`placeInfo.ts` still contain signs of split intent/render/search ownership. Treat
“provider-owned whole turn” as the target contract, not as a proven property.

### Catalogue and geography

- Every recommendation card and actionable Place ID must come from the Supabase catalogue.
- With coordinates, default to an 80 km hard boundary. With only a state label,
  remain in the same state.
- Return one or two cards when only one or two qualify. Never use distant places
  merely to fill three slots.
- Expand the radius only after explicit user consent.
- “Too far”, “another place” and “quieter” refine and re-run retrieval; they do
  not trigger web research defending the old result.
- A named catalogue-place question is place information, not a recommendation
  request, and must never ask for origin, date or party size.
- A non-catalogue place is rejected with a fixed localized message. Do not search
  the web, create a card, offer Save/Ride actions, write a live-fact cache entry,
  or consume a smart turn.

### Conversation and language

- Keep `travelBrief`, `conversationFocus`, `uiLanguage` and `responseLanguage` separate.
- The current explicit question outranks stale Travel Brief fields.
- Greetings, affection, jokes and ordinary chat get natural replies and no cards.
- Help directly explains real Guide capabilities. Never answer with “no verified
  Help section found”.
- SOS is a one-turn interruption. The next clear place question starts a place focus immediately.
- Response language follows the current message. UI language changes only from
  the selector or an explicit interface-language request.
- The user accepted that a detailed place follow-up may currently create a
  second card. Do not prioritise card merging.
- The user also accepted the currently inaccurate date wording in a place card
  as non-priority.

### Emergency boundary

- AI first determines whether the message describes immediate physical danger.
- Explicit unconsciousness, severe bleeding or immediate danger returns the
  server-owned 999/Trusted Family message and actions.
- Ordinary discomfort and phrases such as “help me save this” must not trigger SOS.
- SOS must not display a smart-turn counter.

### Actions and account behaviour

- Save interest, preferences and Ride alerts are prepared first and written only after confirmation.
- Signed-in accounts have no Guide turn limit.
- Guests may retain abuse protection, but provider quota/cooldown must not be
  confused with a user turn limit.
- Deleting all Past Plans must also clear the currently restored conversation;
  it must not remain until “New chat” is clicked.

### UI and navigation

- Composer starts blank: no placeholder example and no prefilled suggestion chips.
- Only real operations appear under replies.
- Recommendation details open the existing `/discover/:placeId` page. Do not
  recreate a Guide-only destination page.
- Returning from Discover restores the previous Guide conversation and scroll position.
- Starting point behaves like map autocomplete. Typing `me` should surface
  sensible entries such as Melaka without covering nearby controls.
- Long card content belongs in the card; chat should contain only a short lead-in.
- Markdown/HTML from a model is never rendered directly.

### Voice input

- Primary path: browser `SpeechRecognition` / `webkitSpeechRecognition`.
- Language selector beside the microphone: English `en-MY`, 中文 `zh-CN`, Bahasa
  Melayu `ms-MY`, Tamil `ta-MY`; no Auto option.
- Interim text is preview-only. Final text fills the editable draft once and is never auto-sent.
- Prevent duplicated final segments and browser-session restarts from duplicating the draft.
- Browser engines may end recognition during pauses. A user recording session may
  restart the physical recognizer until the user presses Stop, while hard
  permission/network errors stop cleanly.
- Groq Whisper is a manual fallback only. After browser failure the user chooses
  it and records again; never upload the previous recording automatically.
- Let’s Tumpang does not store audio in Supabase. The user explicitly consented
  to temporary Groq transcription under that condition.
- Do not bias speech with catalogue place names. The user has seen “test” become
  A’Famosa and “测试” become a stock subtitle/outro phrase.

## 4. Intended tool boundaries

| Tool | Allowed use | Must not do |
| --- | --- | --- |
| `search_catalogue` | recommendation/refinement; returns backend-selected catalogue IDs | answer a named-place question or invent IDs |
| `get_place_information` | resolve a named/contextual catalogue place and return structured facts/sources | create a recommendation batch or accept an external place |
| `get_guide_capabilities` | explain real Guide features | return refusal-style Help RAG text |
| `prepare_guide_action` | prepare supported writes for confirmation | write before confirmation |
| `trigger_emergency` | select the fixed server response/actions after emergency understanding | generate custom emergency prose |
| `change_interface_language` | explicit UI-language changes | infer a full UI switch from every message |

Each tool needs its own mutually exclusive schema. Do not restore a shared
`COMMON_PROPERTIES` object that lets a recommendation call masquerade as place information.

## 5. Reliability and migration 081

`database/sql/085_m6_guide_agent_reliability.sql` is currently untracked locally.
The user says it is already applied remotely. Verify before relying on it.

Expected responsibilities:

- `private.ai_guide_turn_requests`: actor + `client_turn_id` idempotency, lease,
  status, short response cache and expiry; no raw message or audio.
- `private.ai_guide_provider_attempts`: provider/model/stage/status/latency/failure
  metadata; no prompt.
- `private.ai_guide_provider_health`: shared provider cooldown with Retry-After.
- `private.ai_guide_live_fact_cache`: short-lived public place facts and sources.
- service-role-only claim/complete/cleanup functions.

The same `clientTurnId` must cause at most one provider execution. A 429 requires
cooldown plus immediate whole-turn fallback; a longer timeout cannot repair
quota. A 400 contract error should not globally disable a provider after the
contract is fixed.

## 6. User-reported failure history

These are production observations, not hypothetical test cases:

- speech repeated text, failed on short “KL”, mixed languages incorrectly and
  produced unrelated subtitle/outro hallucinations;
- browser speech later worked but stopped mid-sentence too quickly;
- “help me save this to my interest” falsely triggered emergency;
- “我爱你” produced travel recommendations;
- Help returned “no verified Help section”; AI appeared offline too often;
- Gemini 429 was followed by Groq 400 tool-validation error (`JSON` tool not
  declared) or an aborted fallback;
- live place lookup produced 502, timeout and malformed Markdown/HTML;
- chat repeated the same long description as the card;
- named KL Bird Park questions sometimes became a recommendation flow or asked for origin;
- after SOS, “What is fun at KL Bird Park?” returned Melaka recommendations;
- Melaka plans were filled with Penang destinations;
- `i want eat food in KL, what you are suggest` returned Melaka food from stale context;
- a complete planning sentence was incorrectly classified as a missing external catalogue place;
- cards/images failed to open, a duplicate details page was created, and returning
  to chat jumped to the top;
- Show Photo positioning and responsive panels overlapped;
- deleting Past Plans left the active chat visible;
- provider-limit errors persisted across account changes, suggesting global
  provider health/cooldown/deployment state rather than an account turn cap.

Do not “fix” this list one prompt at a time. Trace each failing turn through
preflight routing, provider ownership, tool execution, policy validation,
persistence and rendering.

## 7. Current local changes not yet proven live

The dirty worktree includes, among other work:

- browser speech primary with language picker and manual cloud fallback;
- recognizer restart across recoverable `onend` events;
- responsive location suggestions, date layout and composer controls;
- deterministic routing for explicit recommendation sentences and area phrases;
- v3.1.1 named-place route guard and fixed catalogue-missing policy;
- 081 reliability code, tests and SQL;
- canonical Discover detail navigation and Guide return state.

This list describes local code, not successful production behaviour. Inspect the
actual diff and retain user changes.

Latest dirty-tree inventory: modified Guide business logic and tests,
`GooglePlacesService`, the Edge repository, Discover detail integration, Guide
pages/cards/routes/speech/location/CSS, the `m6-tumpang-guide` Edge entry point,
provider/policy/retrieval/runtime code, Edge tests, Guide Playwright and Module 6
Vitest config. Untracked work includes migration 081, Guide chat cache and
reliability tests, `GuidePlaceSpotlight`, and the new Edge agent, named-place,
place-info, public-payload, reliability, transcription and provider files/tests.
`GuideDestinationDetail.jsx` is deleted because the canonical Discover page is
the intended destination route. Run `git status --short` for the authoritative
file-by-file list before touching anything.

## 8. Latest local test evidence

Most recent reported local results:

- focused route/speech tests: 12 passed;
- Module 6 Vitest config: 22 files / 129 tests passed;
- full Vitest: 94 files / 1068 tests passed;
- Guide Playwright: 12/12 passed across phone, tablet, tablet landscape and desktop;
- production build passed;
- fixture/PWA build passed;
- `git diff --check` passed except line-ending warnings.

Limitations:

- no real microphone quality test was possible in the automated browser;
- the latest local changes were not exercised against live Gemini/Groq;
- the latest local changes were not rechecked against remote persistence;
- the complete Playwright suite was not rerun in the latest pass;
- an earlier full Playwright run had 121 passed, 7 failed and 28 skipped, with
  failures reported mainly in shared axe/visual/server-concurrency areas;
- green tests do not invalidate the user's live failures.

## 9. Files to inspect first

1. `AGENTS.md`, then `docs/ai/UI.md` and `docs/ai/modules/M6_DESTINATION_DISCOVERY.md` as required.
2. `supabase/functions/m6-tumpang-guide/index.ts`
3. `supabase/functions/m6-tumpang-guide/agent.ts`
4. `supabase/functions/m6-tumpang-guide/providers.ts`
5. `supabase/functions/m6-tumpang-guide/namedPlaceRoute.ts`
6. `supabase/functions/m6-tumpang-guide/placeInfo.ts`
7. `supabase/functions/m6-tumpang-guide/reliability.ts`
8. `src/business-logic/guide/TumpangGuideService.js`
9. `src/presentation/components/guide/TumpangGuidePage.jsx`
10. `src/presentation/components/guide/useGuideSpeechInput.js`
11. `src/presentation/components/maps/ConfirmedLocationInput.jsx`
12. `database/sql/085_m6_guide_agent_reliability.sql`

Use `git status` and `git diff` before editing. Several new files are untracked;
that does not mean they are disposable.

## 10. Recommended takeover sequence

1. Do a read-only architecture audit. Map one request through browser, Edge,
   provider loop, tool execution, database and response rendering.
2. Verify deployed frontend/Edge/migration versions. Do not assume the local code
   is what the user is testing.
3. Reproduce three minimal live turns with unique `clientTurnId`s:
   - `What is fun at KL Bird Park?`
   - `i want eat food in KL, what you are suggest`
   - a forced or naturally observed Gemini failure proving Groq whole-turn replay.
4. Inspect private provider-attempt rows and Edge logs by `traceId`; redact user
   text and secrets.
5. Decide whether the existing split pipeline can satisfy whole-turn ownership.
   If not, simplify it before adding more route guards.
6. Validate browser speech on real Chrome/Edge hardware in all four languages.
7. Present findings and proposed boundaries to the user before a broad rewrite.
8. After implementation, stop before tests if the user asks to switch models;
   after tests, stop before migration/deploy/commit/push unless explicitly told.

## 11. Minimum live acceptance script

- Fresh session: `What is fun at KL Bird Park?` → one KL Bird Park information
  card, never origin/date/party clarification.
- Follow-up: `Can you explain that in more detail?` → genuinely new facts.
- `Tell me about Tokyo Disneyland.` → localized catalogue-only refusal, no provider
  request, sources, card or actions.
- `我爱你` → chat only.
- `这个助手怎么用？` → natural, complete capabilities.
- `My friend is unconscious and needs an ambulance now.` → English fixed SOS;
  next KL Bird Park question works normally.
- Melaka + culinary + 12 people → same-state/80 km catalogue results only.
- `i want eat food in KL, what you are suggest` in that same chat → KL results,
  not stale Melaka results.
- Trigger Gemini failure → Groq replays the whole turn; one ownership chain in audit.
- Send the same `clientTurnId` concurrently → one provider execution.
- Voice: `test`, `KL Bird Park`, `测试`, one Malay sentence and one Tamil sentence;
  no repetition, no automatic send and no unrelated subtitle text.
- Type `me` in Starting point → useful suggestions without overlap.
- Open Discover detail and return → same chat scroll.
- Delete all Past Plans and return → deleted conversation remains gone.

## 12. Explicit non-goals for the next fix

- Do not prioritise merging a detailed follow-up into the original card.
- Do not prioritise the inaccurate date phrase inside place information.
- Do not add external-place web answers.
- Do not create another destination details route.
- Do not deploy, apply migrations, commit or push without explicit authorization.
