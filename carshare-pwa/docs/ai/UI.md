# UI.md

## Path Convention

All paths are relative to the `carshare-pwa/` application root unless explicitly stated otherwise.

## Purpose

This file is the shared cross-module UI/UX contract for Let's Tumpang.

Read it before changing presentation components, shared navigation, styling,
responsive behaviour, accessibility, or translating a Figma design into code.
Backend-only work does not need this file.

This contract describes shared design intent and agent behaviour. Current
implementation reality must still be inspected before editing.

## Authority and Sources of Truth

Use this order when UI sources disagree:

1. The current task's confirmed requirements and accepted decisions.
2. This file for shared UI/UX rules and responsive intent.
3. Verified current source code for implementation reality.
4. `docs/figma/` prompts as design references, not frozen specifications.

For exact implemented design-token values, `src/presentation/styles/theme.css`
is the runtime source of truth. Do not silently copy an older Figma value over a
current shared token. Surface meaningful conflicts before changing a shared
contract.

Shared implementation locations:

- `src/presentation/styles/theme.css` - global tokens, app shell, navigation,
  and shared presentation primitives.
- `src/presentation/components/nav/TopNav.jsx` - the shared responsive
  navigation component.
- `src/presentation/components/notifications/NotificationCenter.jsx` - shared
  notification bell popover and protected full inbox.
- `src/presentation/components/icons.jsx` - shared icon set.
- Module style files - module-specific layouts and states only.

## Core Experience

- Let's Tumpang is a mobile-first PWA. The phone experience is the primary
  design target; tablet and desktop are supported responsive experiences.
- Desktop is a deliberate reflow, not a phone-width screen stretched or floated
  in a large empty canvas.
- Preserve established screen flow and visual language unless the task accepts
  a redesign.
- Prefer one clear primary action per view or decision context.
- Reuse shared navigation, tokens, icons, and component patterns. Do not create
  module-local copies of shared UI.
- Keep the interface usable when PWA capabilities, network access, or optional
  services are unavailable.
- Do not add speculative UI, dependencies, animation systems, or design-system
  abstractions without a current requirement.

## Responsive Contract

Design and implement from the narrow layout outward. Use content behaviour,
not named devices, to decide when a component must reflow.

Use the existing shared breakpoint family for new work:

- `700px` - phone navigation and narrow single-column layouts.
- `900px` - compact top navigation and medium-width layout changes.
- `1100px` - wide grids or multi-column layouts that need more room.

Some existing module styles use nearby legacy breakpoints such as `860px` or
`880px`. Do not launch an unrelated global rewrite. When a touched component can
use `700px`, `900px`, or `1100px` without harming its layout, align it then.

### Phone: up to 700px

- Use the persistent bottom navigation and reserve content space above it.
- Prefer a single content column and 16px horizontal page padding.
- Use bottom sheets for short contextual decisions and mobile confirmations.
- Keep the primary action easy to reach. Sticky action bars must not cover page
  content and must include `env(safe-area-inset-bottom)` where relevant.
- Avoid horizontal page scrolling. Locally scrollable rails or chip rows must
  make their scrolling behaviour intentional.
- Forms normally stack vertically. Use appropriate mobile input types and keep
  form controls at 16px text size where needed to prevent browser zoom.

### Compact/tablet: 701px to 1100px

- Treat tablet as a responsive reflow, not a separate full design pass.
- Keep the top navigation; labels may collapse at the shared compact breakpoint.
- Use 24px page padding where space permits.
- Introduce two-column forms, cards, or side panels only when content remains
  readable and touch targets remain comfortable.
- A layout may stay single-column at tablet width when a second column would
  reduce clarity.

### Desktop: above 1100px

- Use the 72px shared top navigation with the same six destinations and active
  state as mobile.
- Use the available width with a centred content maximum around 1280-1440px and
  24-32px page gutters.
- Reflow lists into grids, mobile sheets into centred dialogs, and suitable
  list/detail flows into master-detail layouts.
- Forms may use two columns for related short fields. Keep long text, complex
  choices, and validation messages in a readable single column.
- Do not leave ordinary app pages inside a narrow phone-sized card. A constrained
  reading or authentication column is acceptable when intentional.

## Shared Visual System

### Colour

Use semantic variables from `theme.css` instead of new raw colours when a token
already exists:

- `--teal`, `--teal-dark`, `--teal-tint` - primary actions and selected states.
- `--secondary` - restrained secondary accents.
- `--ink`, `--muted` - primary and secondary text.
- `--bg`, white surfaces, and `--border` - page and surface structure.
- `--success`, `--warning`, `--danger` and their available tints - feedback and
  status semantics.
- `--gold` and `--gold-tint` - reputation/tier use where required.

Do not use colour alone to communicate state. Pair it with text, an icon, or a
shape. A new repeated cross-module role should become a named shared token; a
one-off module value must have a concrete reason.

### Typography

- Display headings use `--font-display` (Poppins with system fallbacks).
- Body, controls, and labels use `--font` (Inter with system fallbacks).
- Keep hierarchy compact: approximately 24px for page headings, 20px for section
  headings, 16px for card headings, 14-15px for body UI, and 12px for captions.
- Do not use tiny text to force content into a layout. Essential text should
  remain comfortably readable on a 375px viewport.
- Use sentence case for labels and buttons unless an established product term
  requires otherwise.

### Spacing, shape, and elevation

- Use an 8px spacing rhythm, with 4px only for tight internal relationships.
- Default page padding is 16px on phone and 24-32px on wider layouts.
- Use `--radius` for controls, `--radius-card` for cards, full pills for chips,
  and a 24px top radius for bottom sheets.
- Use subtle borders and shadows to establish hierarchy. Avoid wrapping every
  section in nested cards.
- Shared icons should use the established outline style and normally render at
  20-24px.

## Navigation and App Shell

The persistent navigation has six destinations in this order:

1. Home
2. Search
3. Ride
4. Message
5. Favourite
6. Profile

Use `TopNav.jsx`; do not implement a separate navigation bar inside a module.
The current route determines the active state.

- The default website entry is public Home. Guests may browse Home, Search
  results, and Published Ride Detail without creating a session. `/search` is
  the only public ride-listing surface.
- Message, Favourite, Profile, the `/ride` management workspace, Publish Ride,
  personal ride/request views, and
  other account-specific services require authentication. A guest who selects
  one is sent to the shared auth page with a clear reason and a safe return
  destination; do not hide the navigation item or force login on initial entry.
- On phone, the auth page is the login/sign-up form only. The desktop journey
  scene must not consume mobile viewport space.
- Sign out must remain directly reachable at the bottom of Profile content on
  phone even though the desktop top-navigation action group is hidden there.
- The six persistent destinations remain unchanged. On desktop, the authenticated
  action group includes a badge-bearing notification bell that opens the shared
  centre. On phone, notification access is in Profile → Account Settings and
  opens the same protected `/notifications` page; never add a seventh tab.
- The desktop auth journey scene keeps the car animated on the complete KL
  Sentral-Genting-Ipoh route; the car must follow the SVG curve rather than use
  an unrelated screen position. Drive the car from the route's own SVG geometry
  so browser CSS/SMIL motion settings do not detach or unexpectedly stop it.

- Phone: fixed bottom bar, icon plus label, safe-area padding, active green state.
- Compact width: top bar may show icons without labels; interactive items still
  need accessible names and tooltips where helpful.
- Desktop: sticky top bar with brand, icon-and-label destinations, and actions.

Route content must remain reachable behind fixed navigation, sticky actions,
the on-screen keyboard, and device safe areas.

## Component Behaviour

### Scrolling and overflow

- Keep page and local overflow regions scrollable, but do not show visible
  browser scrollbars beside the UI on any supported viewport.
- Implement the shared scrollbar suppression in `theme.css`; module styles must
  not restore a visible scrollbar for an individual rail, panel, sheet, or list.
- Do not use `overflow: hidden` merely to remove scrollbar chrome. Mouse wheel,
  touch, trackpad, and keyboard scrolling must continue to work.
- When a locally scrollable row or panel is not self-evident, use layout cues
  such as a partially visible next item or concise helper text instead of a
  visible scrollbar.

### Buttons and actions

- Use primary, secondary, and destructive hierarchy consistently.
- Interactive targets should be at least approximately 44 by 44 CSS pixels on
  touch layouts, including icon-only controls.
- Use verbs that describe the result: `Publish ride`, `Save changes`, or
  `Cancel request`, not vague labels such as `OK`.
- Disable repeated submissions while an action is pending and communicate the
  pending state without shifting the layout unexpectedly.
- Destructive actions require clear wording and confirmation when loss or
  cancellation is difficult to reverse.

### Forms

- Every input needs a visible label; placeholders are examples, not labels.
- Keep helper text and validation next to the relevant field.
- Preserve entered values after validation errors whenever safe.
- Mark required and optional fields clearly and use the correct HTML input,
  autocomplete, input mode, and keyboard behaviour.
- On phone, focus and validation must not be hidden by sticky controls or the
  software keyboard.

### Cards, lists, chips, and status

- Cards group one coherent object or decision. Avoid card-within-card layouts.
- Entire cards may be clickable only when the interaction and focus treatment
  are clear; nested actions must remain independently usable.
- Chips are for compact attributes or choices, not long sentences.
- Status badges use stable labels and semantic styling across modules.

### Sheets, dialogs, and feedback

- Use a bottom sheet for short phone tasks closely related to the current view.
- Present the equivalent desktop interaction as a centred dialog or inline
  detail panel when that better uses the space.
- Move initial focus into a dialog, keep keyboard focus inside it, support Escape
  where safe, and return focus to the trigger when it closes.
- Use inline feedback for field or section problems; reserve global notices for
  app-wide or cross-screen outcomes.
- Search's Destination Discovery chooser is a centred dialog on desktop and a
  bottom sheet at the phone breakpoint. It loads recommendations only when
  opened, traps keyboard focus, closes on Escape, returns focus to its trigger,
  and keeps exact ride search usable when recommendation loading fails.
- Search exposes at most one optional vehicle category and one optional Host
  language in both the desktop filter panel and phone sheet. Cards show these
  classifications only when known; unclassified legacy records remain visible
  under Any and are never assigned a visual default.

## Required UI States

Data-driven screens should deliberately handle the states that apply:

- initial/loading;
- populated;
- empty with a useful next action;
- validation error;
- request or service error with recovery guidance;
- offline or optional-service unavailable;
- pending/disabled during mutation;
- success confirmation when the result is not otherwise obvious.

Do not use dummy success content to hide an unavailable service. Preserve useful
local content and state plainly what is unavailable.

## Accessibility and Motion

- Prefer semantic HTML before adding ARIA.
- All functions must be keyboard reachable with a visible `:focus-visible`
  treatment.
- Icon-only controls need accessible names.
- Images need meaningful alternative text or an empty `alt` when decorative.
- Maintain readable colour contrast and never encode meaning with colour alone.
- Announce important async errors and confirmations when screen-reader users
  would otherwise miss them.
- Keep motion short and purposeful, respect `prefers-reduced-motion`, and do not
  require animation to understand state changes.

## Figma and Design References

Files under `docs/figma/` preserve useful screen flow, copy, and visual
references. They may predate current code or accepted decisions.

When implementing from Figma:

1. Read this file and the relevant module context.
2. Inspect the current shared components and module implementation.
3. Preserve the supplied screen flow and visual language where they do not
   conflict with accepted current behaviour.
4. Identify meaningful conflicts instead of silently redesigning or reverting
   working shared UI.
5. Implement the smallest coherent change across phone and wider layouts.

## Verification Checklist

For a changed screen, verify the relevant items rather than claiming the whole
application is visually complete:

- 375 x 812 phone portrait;
- 768 x 1024 tablet portrait;
- 1024 x 768 tablet landscape or compact desktop;
- 1440 x 1024 desktop;
- no unintended horizontal page scrolling;
- content is not obscured by navigation, sticky actions, safe areas, or keyboard;
- shared navigation order and active state remain correct;
- touch targets, keyboard order, focus visibility, labels, and contrast;
- loading, empty, error, offline, pending, and success states that apply;
- layout reflows intentionally rather than merely scaling;
- targeted tests and `npm run build` when components, routes, or bundling change.

A successful build is not visual verification. Report any viewport, browser, or
device check that could not be completed.

## Change Discipline

- UI changes still follow the relevant module's ownership and context file.
- Change shared UI only for a concrete cross-module reason.
- Do not refactor unrelated screens while applying this contract.
- When a shared token, navigation rule, breakpoint contract, or reusable
  component responsibility changes, update this file and relevant context in the
  same focused change.
- Record only important long-term UI decisions in `docs/ai/DECISIONS.md`; keep
  temporary screen notes out of shared context.
