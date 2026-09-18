# Tumpang Guide routing eval set

Phase 1 removed every deterministic regex safety net that used to pre-empt or
override `chooseGuideTool`'s decision (see `claude-code-giggly-crayon.md`,
Phase 1.1). Since then, routing correctness is enforced entirely by the
prompt in `agent.ts::decisionPrompt()`. Nothing in this repo can prove that
prompt is still correct against the *real* Gemini/Groq models — Vitest only
proves the plumbing around a stubbed decision (schema validation, quota
gating, the search/recommendation boundary). This document is the manual
check that closes that gap.

**Run this pass after every `decisionPrompt()` change, and after any model
version bump (`M6_GUIDE_GEMINI_MODEL` / `M6_GUIDE_GROQ_MODEL`).** Do not ship
a routing-prompt change on the strength of green Vitest runs alone.

## How to run a case

Each case is one Guide turn. Reproduce it either:

- **Through the deployed UI** (simplest, what the owner has already been
  doing per-phase) — open Tumpang Guide, set up the stated context (Travel
  Brief fields, or a prior turn that puts a place into `verifiedPlaceContext`
  via `get_place_information`/a recommendation card), then send the exact
  phrasing and note which mode the reply actually used (visible via the
  source badge / dev tools network tab on the `m6-tumpang-guide` response's
  `mode` field).
- **Directly against the edge function**, for tighter control over context
  and to force a specific provider. Requires either a `localhost`/
  `127.0.0.1` origin or a signed-in user id listed in
  `M6_GUIDE_QA_USER_IDS`:

  ```bash
  curl -s -X POST "$SUPABASE_URL/functions/v1/m6-tumpang-guide" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $SUPABASE_ANON_KEY" \
    -d '{
      "message": "food in Penang",
      "planState": {"language": "en"},
      "placeContext": [],
      "recentMessages": []
    }' | jq '.mode, .assistantMessage'
  ```

  `handleTurn`'s own provider loop always tries Gemini first and only calls
  Groq if Gemini's whole turn fails, and it always overwrites any
  `__ownedProvider` a request body supplies — there is no per-request flag
  to force which provider handles routing. To specifically eval Groq's
  routing prompt, temporarily unset `GEMINI_API_KEY` in a staging
  environment (or point `M6_GUIDE_GEMINI_MODEL` at an invalid model id) so
  every case in this run falls straight through to Groq, then restore it
  afterwards. Run the full set once with Gemini live and once with it
  disabled — a real regression may only show up on one of the two.

For each case, record: actual `mode`, which provider answered, and whether
`assistantMessage` matches the tone rules (warm/lively, calm during
emergency). A case fails if `mode` doesn't match `expectedMode`, even if the
final answer text still reads acceptably — a right-answer-wrong-mode result
is exactly the kind of quiet miscategorization this pass exists to catch
(e.g. a recommendation-shaped answer delivered as `place_info`, which would
also trip the Phase 2 search/recommendation schema boundary and get
silently stripped).

## Case categories

### A. Named-place question vs. destination-area recommendation

The pair `decisionPrompt`'s `routingExamples` field is built around — the
single highest-risk confusion now that regex pre-emption is gone.

| # | Language | Phrasing | Context | Expected mode |
|---|----------|----------|---------|----------------|
| A1 | en | "food in KL" | none | `recommend` |
| A2 | en | "what's good to eat at KL Bird Park?" | none | `place_info` |
| A3 | en | "suggest something to eat in Penang" | none | `recommend` |
| A4 | en | "tell me about Zoo Negara" | none | `place_info` |
| A5 | zh-CN | "吉隆坡有什么好吃的" | none | `recommend` |
| A6 | zh-CN | "国家动物园怎么样" | none | `place_info` |
| A7 | ms | "makanan sedap di Pulau Pinang" | none | `recommend` |
| A8 | ms | "cerita tentang Zoo Negara" | none | `place_info` |
| A9 | ta | "பினாங்கில் சாப்பிட நல்ல இடம்" | none | `recommend` |
| A10 | ta | "Zoo Negara பற்றி சொல்லுங்கள்" | none | `place_info` |
| A11 | en | "another place" | prior turn recommended 3 places | `recommend` (different/quieter refinement) |
| A12 | en | "tell me more about that" / "why the first one" | prior turn focused KL Bird Park | `place_info`, `requestedPlaceName` = "KL Bird Park" |

### B. Indirectly-worded recommendation requests

Phrasing that never says "recommend" but is still a destination request.

| # | Language | Phrasing | Expected mode |
|---|----------|----------|----------------|
| B1 | en | "I'm bored this weekend, any ideas?" | `recommend` |
| B2 | en | "somewhere quieter than that" | `recommend` (recommendationMode adjustment) |
| B3 | en | "we want to bring the kids somewhere fun" | `recommend` |
| B4 | zh-CN | "这周末不知道去哪里好" | `recommend` |
| B5 | ms | "ada cadangan tempat untuk hujung minggu ini?" | `recommend` |
| B6 | ta | "இந்த வார இறுதியில் எங்கே செல்லலாம்?" | `recommend` |

### C. Small talk that resembles a place name or a recommendation

| # | Language | Phrasing | Expected mode |
|---|----------|----------|----------------|
| C1 | en | "I love KL" | `respond_conversationally` |
| C2 | en | "KL is amazing, thanks!" | `respond_conversationally` |
| C3 | en | "you're a great guide" | `respond_conversationally` |
| C4 | zh-CN | "谢谢你，我很喜欢和你聊天" | `respond_conversationally` |
| C5 | ms | "Pulau Pinang memang cantik" (no request attached) | `respond_conversationally` |
| C6 | ta | "நீங்கள் சிறந்த வழிகாட்டி" | `respond_conversationally` |

### D. "Help me save this" vs. genuine danger

Regression cases for the emergency/ordinary-discomfort boundary — this is
the one place a narrow, non-promoting classifier (`isOrdinaryDiscomfortText`
in `policy.ts`) still runs downstream of the model's own call, so both the
model's `trigger_emergency` choice and the narrowing behavior need checking.

| # | Language | Phrasing | Expected mode |
|---|----------|----------|----------------|
| D1 | en | "help me save this place" | `action` (record_interest), never `trigger_emergency` |
| D2 | en | "someone is unconscious, call 999" | `trigger_emergency` |
| D3 | en | "I feel a bit unwell" | NOT `trigger_emergency` (ordinary discomfort) |
| D4 | zh-CN | "我感觉不舒服" | NOT `trigger_emergency` |
| D5 | zh-CN | "有人昏倒了，快叫救护车" | `trigger_emergency` |
| D6 | ms | "tolong simpan tempat ini" | `action`, never `trigger_emergency` |
| D7 | ta | "ஒருவர் மயங்கி விழுந்துவிட்டார்" | `trigger_emergency` |

### E. `get_travel_info` vs. `place_info` vs. `recommend` (Phase 2)

The newest tool, and the one with the least real-model mileage.

> **Known regression, found via this exact category (2026-09-03 live test):**
> after several consecutive `recommend` turns in one conversation, E1/E2/E3/E4
> below all misrouted to `search_catalogue` instead of `get_travel_info` —
> the model imitated the recent tool-call pattern instead of reading the
> message itself. Fixed by adding `conversationMomentumWarning` to
> `decisionPrompt()` in `agent.ts`. Re-run this category with several
> `recommend` turns immediately before it (not just cold, as a first
> message) — that conversational setup is what triggered the miss.

| # | Language | Phrasing | Context | Expected mode |
|---|----------|----------|---------|----------------|
| E1 | en | "will it rain this weekend?" | none | `travel_info`, no `relatedPlaceName` |
| E2 | en | "how do I get around without a car?" | none | `travel_info` |
| E3 | en | "what's the weather like at KL Bird Park on my visit date?" | KL Bird Park focused | `travel_info`, `relatedPlaceName` = "KL Bird Park" |
| E4 | en | "is it walkable from the hotel to KL Bird Park?" | KL Bird Park focused | `travel_info` (not `place_info` — this is transport, not venue facts) |
| E5 | zh-CN | "这个周末会下雨吗" | none | `travel_info` |
| E6 | ms | "macam mana nak pergi ke sana tanpa kereta" | Zoo Negara focused | `travel_info`, `relatedPlaceName` set |
| E7 | ta | "இந்த வார இறுதியில் மழை பெய்யுமா" | none | `travel_info` |

For every E-series case, also check the **response body**, not just the
mode: `recommendations` and `actions` must both be empty arrays. If either
is non-empty, `assertNoCardsOrActionsFromSearch` in `policy.ts` should have
already caught and stripped it server-side (look for
`m6_guide_search_boundary_violation` in the function logs) — a case that
needs that safety net to fire is still a routing-prompt regression worth
fixing at the source, not just a caught-and-degraded response.

### F. Mixed-language follow-ups

| # | Turn 1 (language) | Turn 2 (different language) | Expected mode for turn 2 |
|---|---|---|---|
| F1 | en: "food in KL" | zh-CN: "第一个怎么去" | `place_info` or `travel_info`, resolving "第一个" (the first one) to the matching recommended place |
| F2 | zh-CN: "推荐一个自然景点" | en: "somewhere else" | `recommend`, different/quieter |
| F3 | ms: "cadangan makanan di Melaka" | ta: "அதைப் பற்றி மேலும் சொல்லுங்கள்" | `place_info`, resolving "அதை" (that) to the focused place |

## Scoring

Track results in a copy of this table (owner-run, not automated) with an
extra `actual mode` / `pass` column per case. A pass rate below 100% on
category A or D blocks shipping the prompt change that caused it — those
are the two categories with the highest cost of a wrong answer (silent
miscategorization, or a missed/false emergency). A miss elsewhere in B/C/E/F
is a prompt-wording fix, not necessarily a blocker.

## What this does not cover

- Voice input accuracy (Phase 3) — separate real-device pass, not a routing
  question.
- Whether a `recommend` batch's actual place choices are good — that's
  `retrieval.ts` ranking, deterministic and already unit-tested; this eval
  set only checks *mode selection*, not recommendation quality.
- Load/latency behavior under real traffic.
