# Tumpang Guide — canonical product and architecture specification

Updated: 2026-09-02

For takeover status, failure history and exact test/deployment caveats, start
with `docs/TUMPANG-GUIDE-CLAUDE-HANDOFF.md`. This file defines the intended
system. It does not claim that the current implementation fully satisfies it.

## Product boundary

Tumpang Guide is a conversational layer over the existing Let’s Tumpang
catalogue, Discover detail pages, interests, Ride search/alerts and travel
preferences. It may chat, explain and teach, but recommendation cards and
actions are constrained by trusted application data.

- Recommendations come only from recommendable Supabase catalogue rows.
- Non-catalogue places receive a fixed localized refusal. They are not searched,
  cached, carded, saved or used for Ride actions.
- Signed-in users are not subject to a Guide-turn allowance.
- Account writes require confirmation.
- Immediate emergencies use a fixed server response after AI understanding.

## Provider-owned turn

Gemini is the primary owner of a complete turn. It receives the original
message, recent context, Travel Brief and conversation focus; it may answer
directly or call up to two read-only tools. Tool results return to the same
Gemini attempt for the final response.

If any Gemini stage times out, is rate-limited, has an auth/model/contract error,
uses invalid tool arguments or fails semantic output validation, discard the
entire attempt. Groq then repeats the complete turn from the pre-turn state and
original message. A response must never contain Gemini intent combined with
Groq rendering, translation or grounded search.

If both providers fail, preserve the plan and conversation and show a transparent
retry state. Deterministic recommendation content is allowed only in explicit
offline/fixture mode.

Provider and model identity remain in private audit only. Public responses expose
`clientTurnId`, `traceId`, `edgeVersion`, safe tool-result summaries and fallback
state, but no provider ownership metadata.

## State model

- `travelBrief`: origin, optional coordinates, dates, party, categories, budget
  and refinement preferences. It persists across topics.
- `conversationFocus`: `place`, `recommendation_batch`, `capabilities`, `action`,
  `emergency` or `none`.
- `uiLanguage`: changed only through the selector or explicit request.
- `responseLanguage`: inferred from the current message without translating
  the whole UI or prior history.

The explicit current question outranks stale Travel Brief fields. SOS is a
single-turn interruption rather than a permanent focus.

## Tools

Every tool has a dedicated schema.

- `search_catalogue`: recommendation and refinement only. The backend applies
  catalogue, distance and ranking rules and returns selected Place IDs.
- `get_place_information`: resolves a named/contextual catalogue place and
  returns structured public facts, uncertainty, checked time and sources.
- `get_guide_capabilities`: supplies the Guide’s actual supported features.
- `prepare_guide_action`: prepares a supported write for user confirmation.
- `trigger_emergency`: selects the server-owned emergency response/actions.
- `change_interface_language`: explicit interface-language change only.

Ordinary chat calls no travel tool. A named catalogue place cannot become a
recommendation or missing-field clarification. A non-catalogue name is rejected
before provider/web search and does not consume a smart turn.

## Recommendation rules

- Coordinates present: default candidate radius is 80 km.
- State label only: remain in the same state.
- Never add distant results to reach three cards.
- Offer a real Expand range action when local supply is insufficient; expand only
  after confirmation.
- Date and party are optional unless a requested activity, weather, Ride seats or
  group size makes them material.
- “Too far”, “another place” and “quieter” update the retrieval constraints and
  re-run catalogue search.
- Ranking and role assignment are backend-owned. AI explains selected results but
  cannot change order, IDs, evidence or actions.

## Place information and Help

A catalogue place question such as `What is fun at KL Bird Park?` goes directly
to place information even when Travel Brief is empty. It never asks for origin,
date or group size. Contextual follow-ups resolve against the current verified
focus. Long structured content appears in the card; chat contains a short lead-in.

Help uses a server-owned capability contract so common questions receive a
natural and accurate answer even without a matching Help row. It must not fall
back to refusal-style “no verified Help section” text.

Provider Markdown/HTML is parsed into validated fields and never rendered raw.

## Emergency and actions

The AI distinguishes urgent physical danger from ordinary discomfort and app
requests. Clear unconsciousness, severe bleeding or immediate danger produces
the server’s fixed 999 and Trusted Family response. “Help me save this” and
similar action language is not an emergency. SOS shows no turn counter.

Save interest, travel preferences and Ride alerts are prepared first and written
only after explicit confirmation. Publishing, seat requests, cancellations and
profile edits remain on their established application pages.

## UI and navigation

- Empty composer with no example placeholder or prefilled prompts.
- Language selector beside the microphone.
- Starting point uses map-like autocomplete with a responsive, non-overlapping
  result list.
- Recommendation cards open the existing `/discover/:placeId` route and pass a
  Guide return path, dates and scroll state.
- Returning restores the conversation and scroll position.
- Past Plans deletion immediately clears any active restored copy.

## Voice

Browser `SpeechRecognition`/`webkitSpeechRecognition` is primary. Supported
choices are English `en-MY`, 中文 `zh-CN`, Bahasa Melayu `ms-MY` and Tamil
`ta-MY`; there is no Auto mode. Interim text is preview-only. Deduplicated final
text fills the editable draft once and never auto-sends.

A logical recording session may restart the physical browser recognizer after a
normal pause until the user presses Stop. Permission, network, microphone and
unsupported-language errors stop cleanly.

Groq transcription is a user-selected fallback after browser failure. It records
again, never silently uploads prior audio and never stores audio in Supabase.
Catalogue names are not injected as speech bias.

## Reliability and data

Migrations 079/080 provide Guide data and stability contracts. Migration 081
adds request idempotency/lease, private provider attempts, shared provider
health/cooldown and short live-fact caching. The user reports 081 applied, but
remote state must be verified before relying on it.

The same actor and `clientTurnId` must execute at most one provider turn. A
completed request replays its cached response; an active lease returns processing;
an expired lease may be safely claimed. Provider 429/auth/model failures trigger
the appropriate shared cooldown and whole-turn fallback. Raw prompts, messages
and audio are not stored in reliability tables.

The browser deadline is 110 seconds. Each provider receives a bounded whole-turn
budget while leaving time for database completion inside Supabase hosted limits.
Timeout extension is not a substitute for correct failover or quota handling.

## Configuration

Browser:

```text
VITE_TUMPANG_GUIDE_ENABLED=true
VITE_TUMPANG_GUIDE_MODE=gemini
VITE_DISCOVERY_DATA_SOURCE=supabase
```

Server-only examples:

```text
GEMINI_API_KEY=<server only>
GROQ_API_KEY=<server only>
M6_TUMPANG_GUIDE_AI_ENABLED=true
M6_GUIDE_PRIMARY_PROVIDER=gemini
M6_GUIDE_SECONDARY_PROVIDER=groq
M6_GUIDE_GEMINI_MODEL=<supported configurable Flash model>
M6_GUIDE_GROQ_MODEL=openai/gpt-oss-20b
M6_GUIDE_ALLOWED_ORIGINS=http://localhost:5173,https://letstumpang.netlify.app
M6_GUIDE_VISITOR_PEPPER=<random server value>
```

Provider keys must never use a `VITE_` prefix or enter browser bundles.

## Verification rule

Automated tests must remain isolated from live providers. After unit, Edge,
Playwright, axe, production and PWA checks, verify the deployed version separately
with real Gemini, forced Gemini-to-Groq fallback, catalogue search, browser voice
on hardware and Supabase persistence. Always correlate `traceId`, Edge version,
frontend build and migration state.
