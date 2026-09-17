# Module 6 Mobile QA Handoff (for Codex)

Branch: `Module6_Destination_Discovery_&_Tumpang_Guide`, commit `2fa6ff5`
(`[Module6] Fix photo-carousel flicker, home scroll restore, Guide voice
settings panel, and cloud transcription false rejects`). This commit is
already in the local branch history - do not re-do the work it describes,
only verify it and pick up from where it leaves off.

## Why this file exists

The user found four real bugs testing Module 6 (Destination Discovery +
Tumpang Guide) on an actual Android phone. Claude (this session) diagnosed
and fixed all four, but only got to *live-verify* two of them end-to-end in
a browser before handing off - the other two are code-correct and
unit-tested, but need a real device (or at least a real Google Places API
key) to see the actual reported symptom disappear. This document tells you
exactly what was already fixed, what was verified how, and what is still
open.

## What was fixed and how confident each one is

### 1. Voice settings panel invisible / garbled (guide.css) - VERIFIED LIVE, high confidence

File: `src/presentation/m6-discovery/styles/guide.css`
(`.guide-voice-settings` block, plus one dead-code removal in the same
`@media (max-width: 700px)` block that also touches
`.guide-composer__input-row`).

This one went through two attempts in the same session - the first attempt
(`justify-self: start` + `position: absolute` kept, with a mobile-only
`position: static` override) was based on a wrong theory and made things
*worse*, not better: it caused a garbled overlapping popover on desktop and
a squeezed ~90px-wide popover on mobile (the two "weird boxes" the user
reported). That was caught and fixed within the same session by actually
opening the running dev server in a browser and inspecting computed
styles/`getBoundingClientRect()` live, rather than reasoning about the CSS
in the abstract.

The root cause, confirmed via live DOM inspection: `.guide-voice-settings`'s
grid column (`minmax(0, 1fr)`) is *not* actually wide in practice, because
the other two auto-sized columns in the same row (the mic button and the
full "Send message" button) already consume most of the row's width on a
narrow viewport - so the column was always going to be ~80-100px regardless
of any `justify-self` tweak, and any `position: absolute` popover anchored
to it (opening upward, inside `.guide-chat`'s `overflow: hidden`) had no
reliable free space to render into at any width.

**The actual fix**: the language panel now renders in normal document flow
(`position: static`) at every width, never `position: absolute`. The
`<details>` element spans the full input-row width only while open
(`.guide-voice-settings[open] { grid-column: 1 / -1; }`) - CSS grid's
default sparse auto-placement then pushes the mic/send buttons down to a
fresh row on their own, with no JS and no manual repositioning needed.
Verified live in the actual running dev server (`localhost:5173/assistant`,
via `mcp__Claude_Browser__javascript_tool` computed-style/rect inspection
and screenshots) at both a ~800px desktop width and a 375px mobile emulation:
closed state stays a small pill next to mic/send, open state cleanly fills
the row with no overlap, no clipping, no squeezing.

**Nothing left to do here** unless the user reports a *new* visual issue
after retesting on their actual phone with a hard refresh (their earlier
"still broken" report was very likely a stale/mid-HMR browser tab from
before this second, corrected pass - the live tests above were run *after*
this fix landed, against the real file, with no injected overrides).

### 2. Home screen scroll position not restored (DiscoveryJourney.js, HomeScreen.jsx, main.jsx) - VERIFIED LIVE, high confidence

Files: `src/business-logic/m6-discovery/discovery/DiscoveryJourney.js`
(new `consumeExploreReturn()`), `src/presentation/m6-discovery/HomeScreen.jsx`
(the scroll-restore `useEffect`, plus `useAccountStatus` now also returns a
`loading` flag, plus the preference-prompt effect now sets a `promptChecked`
flag), `src/main.jsx` (`history.scrollRestoration = 'manual'`).

Root cause: the old restore logic only fired via the in-app "Back to
destinations" button (which injected `restoreExploreScrollY` into router
`state`); a native/OS back gesture is a plain history `POP` that never
carried that state, so the browser's own uncontrolled default scroll
restoration raced HomeScreen's async data refetch and landed in the wrong
place.

**Verified live**, end to end, in the real running dev server: scrolled
`window` to 1200px on `/home`, clicked a real destination card (confirmed
via `sessionStorage` inspection that `saveExploreReturn` wrote
`{"url":"/home","scrollY":1199}`), then called `history.back()` to simulate
a real native back gesture (not the in-app button). Result: at ~300ms the
page was still at the browser's own wrong native-restore position (681px -
exactly the race condition this fix targets), and by ~1500ms it had
self-corrected to 1199px via the new `consumeExploreReturn()`-based effect,
with `sessionStorage`'s saved value correctly cleared (consumed exactly
once) afterward. This is the code working as designed.

**Nothing left to do here.**

### 3. Place-photo carousel flicker (PlaceImage.jsx, photoLoadCache.js) - CODE-VERIFIED AND UNIT-TESTED, but NOT verified against the actual real-device symptom

Files: `src/presentation/m6-discovery/components/discover/PlaceImage.jsx`,
new `src/presentation/m6-discovery/components/discover/photoLoadCache.js`,
new test `src/presentation/m6-discovery/__tests__/photoLoadCache.test.js`.

Root cause: `DestinationDetail.jsx`'s `Carousel` only keeps the *active*
slide mounted (a ternary, not a real multi-slide track), so swiping away
from a photo and back is a genuine unmount/remount of `PlaceImage`, which
reset its `revealed`/`failed` `useState`s every time - and `failed` was a
one-shot flag with no success cache, so a single transient `onError` (very
plausible on real mobile cellular data) permanently blanked that slide for
the remainder of that short-lived mount.

The fix adds a module-level `Map` cache (`photoLoadCache.js`, mirrors the
existing `coverageCache` pattern in `StreetView.js`) that remembers whether
a given photo URL has already loaded or permanently failed, read once at
mount so a photo that already proved it loads stays shown across a remount
instead of re-demanding a "View real photo" tap; `onError` now allows one
retry (forcing a fresh `<img>` via a changed `key`) before giving up and
writing to the cache.

**What is NOT yet verified**: this dev environment
(`C:\Users\SCSM11\Desktop\CD_Assignment\CollaborativeDev\carshare-pwa`)
has no configured Google Places Photo API key, so `buildPlacePhotoUrl()`
always returns `null` and every place always shows the illustration
fallback - there is no way to load a *real* photo, trigger a *real*
`onError`, or watch the retry/cache actually engage, from this machine.
What was confirmed: `photoLoadCache.js`'s own logic is unit-tested (5 cases,
all passing - get/set/clear/null-safety), and `PlaceImage.jsx` renders with
no runtime error in the illustration-fallback state (confirmed live via
`document.querySelector('.dsc-poster')` / `.dsc-reveal` both present, no
console errors) - i.e., the change did not break anything, but the actual
"stops flickering on a real phone with a real photo" claim rests on code
review + unit tests only, not an end-to-end repro.

**What to do**: if you have a Supabase project / `VITE_GOOGLE_MAPS_PLACES_API_KEY`
available, or the user does real-device retesting, confirm: (a) a photo that
loads once stays shown when swiping the carousel away and back to it, (b) a
simulated network failure (e.g. throttle/offline mid-load in devtools) shows
one retry before falling back to the illustration, not an immediate
permanent fallback.

### 4. Groq cloud transcription rejecting genuine short mobile utterances (transcription.ts, index.ts) - CODE-VERIFIED AND UNIT-TESTED, but NOT verified against a real Groq response

Files: `supabase/functions/m6-tumpang-guide/transcription.ts` (widened
`uncertainShortUtterance` thresholds, `-.55`→`-.75` /
`.35`→`.5`; attaches the computed `quality` diagnostics object to the
thrown error), `supabase/functions/m6-tumpang-guide/index.ts` (the existing
`m6_guide_transcription_failure` log line now also logs that `quality`
object).

This is the one fix in the batch that is a **deliberately conservative,
data-free guess**, stated as such in the plan and in the code comment: there
is no way to know from this machine what a real failing Groq response's
`avg_logprob`/`no_speech_prob` actually looked like on the user's phone, so
the exact new threshold numbers are an informed but unverified estimate.
`echoCancellation`/`noiseSuppression`/`autoGainControl` in
`useGuideSpeechInput.js`'s `getUserMedia` call were deliberately left
untouched for the same reason - no data to justify changing them either
way.

**What is verified**: the two new/extended test cases in
`supabase/functions/m6-tumpang-guide/__tests__/transcription.test.js` pass
(one proving the widened threshold now *accepts* a case that would have
been rejected under the old `-.55`/`.35` numbers, one proving a genuinely
bad short utterance is still rejected under the new, wider thresholds), and
the existing two tests ("accepts a confident genuine short utterance",
"rejects provider segments that indicate silence or very low confidence")
still pass unchanged.

**What to do**: this is the one fix most likely to need a second pass. If
the user (or you) can get a real failing `transcription_low_confidence`
request from Supabase Functions logs after this deploys, the `quality`
field now attached to the `m6_guide_transcription_failure` log event has
the real `avg_logprob`/`no_speech_prob`/`duration` numbers - use those to
decide whether the threshold needs to move further, or whether the real fix
turns out to be the `getUserMedia` audio constraints after all. Do not
guess again without that data if you can help it - that is exactly the
trap this fix was designed to avoid repeating.

## Process notes worth knowing before you touch this branch

- The real, current checkout is
  `C:\Users\SCSM11\Desktop\CD_Assignment\CollaborativeDev\carshare-pwa`.
  Do not use any copy under a `.claude/worktrees/` folder - those are stale.
- `Development` was already merged into this branch (fast-forward, clean, no
  conflicts) earlier in this session and includes teammates' M1 (reputation),
  M2 (content moderation), M3 (message reports) work. None of it touches any
  file this handoff discusses.
- One pre-existing, unrelated issue was found (not fixed, not caused by this
  work): `tests/contracts/m4/Module4Sql.test.js` fails because
  `database/sql/109_*`/`110_*` numbers were independently reused by both the
  M1 and M3 branches when they were merged into `Development`. This needs a
  human decision (whose migration gets renumbered) before it can be fixed -
  flagged to the user, not yet resolved either way.
- Full `npx vitest run` was green (1628/1628, only the pre-existing
  Module4Sql failure above, unrelated) as of this commit. `npm run build`
  also succeeds.
- Git note: this repo occasionally accumulates stray, broken
  `refs/codex/turn-diffs/checkpoints/...` refs (apparently a side effect of
  Codex CLI's own checkpointing) that can break `git fetch`/`git gc`. If you
  hit `fatal: bad object refs/codex/turn-diffs/checkpoints/...`, that ref is
  the problem, not your working tree - `git update-ref -d "<the exact ref
  path from the error>"` removes it safely; it does not affect any real
  commit history.
