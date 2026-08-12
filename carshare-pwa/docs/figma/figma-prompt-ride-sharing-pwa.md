# Figma Design Prompt — Ride-Sharing PWA (Module 2 Focus)

## How to use this document
- **Implementation authority:** This is a Figma/design reference. For repository
  implementation, read `docs/ai/UI.md` first; it is the current shared UI/UX
  contract and takes precedence when this prompt is outdated.
- Paste the **Design System** section once into your AI design tool (Figma "First Draft"/AI features, Uizard, Galileo AI, v0, etc.) so it's used as shared context, then paste each **screen prompt** one at a time.
- If your tool accepts one long brief, you can paste the whole document in one go.
- Replace **[App Name]** with your actual project/app name throughout.
- Only the **Ride** tab and its screens (Module 2) need to be fully functional/hi-fi. Everything else is a static placeholder for now — this is called out explicitly in Section 5 so the AI/designer doesn't over-build the other tabs.

---

## 1. App Overview (context for the AI tool)

**[App Name]** is a Progressive Web App (PWA) for community ride-sharing, usable on both mobile phones (installable, app-like) and desktop web browsers. Hosts publish rides with a fixed route, available seats, non-monetary contribution requirements, and optional cultural/culinary waypoints along the way. Passengers search for rides, request to join, and message hosts once accepted. The app also tracks eco-impact (carbon savings) and a reputation/trust system, but **for this design pass we are only building the navigation bar and the full "Ride" module (ride publishing, browsing, requests, lifecycle, and reviews)**. All other sections exist only as placeholders.

Tone: clean, trustworthy, community-driven, eco-conscious. Think "Airbnb meets BlaBlaCar," with a fresh green identity.

---

## 2. Design System

### Platform & responsive behavior
- Mobile-first PWA. Design two frame sets per screen:
  - **Mobile:** 375 × 812 (iPhone-sized), bottom tab bar navigation.
  - **Web/Desktop:** 1440 × 1024, top navigation bar, content reflows into a wider layout (e.g., ride lists become a grid, forms become centered two-column panels).
- Tablet (768–1024px) is a simple reflow between the two — not a separate full design pass.

### Color palette — Green theme

| Token | Hex | Usage |
|---|---|---|
| Primary Green | `#16A34A` | Primary buttons, active nav state, links, brand accents |
| Primary Green (Dark/Pressed) | `#15803D` | Button hover/pressed states |
| Primary Green (Tint) | `#DCFCE7` | Chip backgrounds, selected-state backgrounds, subtle highlights |
| Secondary Teal | `#0D9488` | Secondary actions, icons, secondary badges |
| Background | `#F6FAF7` | App/page background (soft mint-gray) |
| Surface | `#FFFFFF` | Cards, sheets, inputs |
| Border | `#E5E7EB` | Card/input borders, dividers |
| Text Primary | `#111827` | Headings, primary text |
| Text Secondary | `#6B7280` | Captions, helper text, inactive nav |
| Warning | `#F59E0B` | Warnings, "In Transit" status |
| Error | `#EF4444` | Errors, destructive actions, "Cancelled" status |
| Info | `#3B82F6` | Informational badges, "Published" status |

**Trip lifecycle status colors** (used throughout Module 2, see FR-2.9):

| Status | Text/Icon Color | Background |
|---|---|---|
| Draft | `#9CA3AF` | `#F3F4F6` |
| Published | `#3B82F6` | `#DBEAFE` |
| Matched | `#7C3AED` | `#EDE9FE` |
| In Transit | `#F59E0B` | `#FEF3C7` |
| Completed | `#16A34A` | `#DCFCE7` |
| Cancelled | `#EF4444` | `#FEE2E2` |

### Typography
- Headings: **Poppins**, SemiBold/Bold (H1 24/32px, H2 20/28px, H3 16/24px)
- Body/UI: **Inter**, Regular/Medium (Body 14–15px, Caption/label 12px, Button label 14px Medium)

### Components style
- Corner radius: 16px on cards, 12px on buttons/inputs, full-pill (999px) on chips/tags, 24px on bottom-sheet top corners.
- Shadows: soft, e.g. `0px 2px 8px rgba(0,0,0,0.06)` on cards; slightly stronger on the FAB and bottom sheets.
- Spacing: 8px base grid; 16px screen padding on mobile, 24–32px on web.
- Icons: outline/line style, 24px, ~1.75px stroke (Feather/Lucide-style); active/filled variant for the selected nav icon.
- Buttons: Primary (solid green, white text), Secondary (white bg, green border/text), Destructive (red text/border or solid red for confirm-cancel actions).

---

## 3. Navigation Bar

The nav bar has **6 items**: **Home, Search, Ride, Message, Favourite, Profile**. It is the one persistent element across every screen.

### Mobile — bottom tab bar
- Fixed to the bottom of the viewport, full width, height ~64–72px + safe-area padding.
- White surface, subtle top border/shadow separating it from content.
- 6 evenly spaced items, each: 24px icon + 11–12px label underneath.
  - Home → house icon
  - Search → magnifying glass icon
  - Ride → car / steering-wheel icon
  - Message → chat-bubble icon (with small unread-count badge)
  - Favourite → heart icon
  - Profile → circular user avatar
- **Active state** (Ride tab, since that's what we're building): filled icon + label in Primary Green `#16A34A`.
- **Inactive state** (Home, Search, Message, Favourite, Profile): outline icon + label in Text Secondary `#6B7280`. These are tappable but lead only to simple placeholder screens (see Section 5).

### Web/Desktop — top nav bar
- Fixed top bar, height ~72px, white surface, bottom border/shadow.
- Left: logo/app name.
- Center-left: the same 6 items as horizontal icon+label pills; the active "Ride" item has a Primary Green Tint (`#DCFCE7`) pill background and green text/icon.
- Right: notification bell icon, profile avatar with dropdown chevron.
- Between 768–1024px, collapse labels and show icon-only with tooltips on hover.

---

## 4. Screens to Design in Full — Module 2: Ride Sharing Management

These are the screens that should be fully fleshed out, hi-fi, with real components and states. Each includes both a mobile and web frame.

### Screen 1 — Ride Hub (Ride tab home)
**Covers:** FR-2.3 (basic search), FR-2.5, FR-2.6 (entry points)
**Prompt:**
Design the landing screen for the "Ride" tab. Top of screen has a segmented control with two tabs: **"Find a Ride"** and **"My Rides"**, defaulting to "Find a Ride."
- **Find a Ride** view: a search card at the top with three fields — "From" (pickup location), "To" (destination), "Date" (date picker) — and a green "Search" button. Below it, a scrollable list of ride result cards. Each card shows: route as "Pickup → Destination," date/time, seats available (e.g., "3 seats left"), journey-scale badge ("Urban" or "Intercity"), a small row of restriction-tag chips (e.g., "Pet-friendly," "No smoking"), the host's avatar + name + reputation score/tier badge, and the non-monetary contribution requirement as a short tag (e.g., "Contribution: Snacks").
- **My Rides** view: two sections, "Hosting" and "Joining," each listing ride cards with a lifecycle status chip (Draft/Published/Matched/In Transit/Completed/Cancelled, colored per the status palette above).
- A green circular Floating Action Button (FAB) in the bottom-right corner labeled with a "+" icon, opening the Publish a Ride flow.
- On web: search card and results become a two-column layout — filters/search on the left (sticky), results grid on the right.

### Screen 2 — Ride Detail
**Covers:** FR-2.4, FR-2.9 (status), FR-2.14 (route lock), FR-2.16 (waypoints), FR-2.2 (request entry point)
**Prompt:**
Design a ride detail screen. Header shows a static map preview of the route with pickup and destination pins. Below the map:
- A horizontal lifecycle stepper/timeline: Draft → Published → Matched → In Transit → Completed, with the current step highlighted in Primary Green and a separate red "Cancelled" state style shown as an alternate end-cap.
- Trip info block: pickup point, destination, departure date/time, seats available, journey-scale badge (Urban/Intercity).
- A small info banner: "This ride follows a fixed route — requests with a significant detour are automatically declined," representing the route-lock rule.
- Restriction tags as chips (pet-friendly, no smoking, etc.) and the non-monetary contribution requirement as a highlighted card.
- A **"Culinary & Cultural Waypoints"** section: horizontally scrollable cards, each with a small photo, waypoint name, and one-line description.
- Host section: avatar, name, reputation score, reputation level, tier badge (Bronze/Silver/Gold).
- Sticky bottom action bar: for a passenger viewing an open ride, a primary green **"Request to Join"** button; for the host viewing their own ride (pre-match), **"Edit Ride"** and **"Manage Requests"** buttons instead.

### Screen 3 — Publish a Ride (multi-step form)
**Covers:** FR-2.1, FR-2.15
**Prompt:**
Design a multi-step "Publish a Ride" flow with a progress indicator (step dots or a thin progress bar) at the top and a "Save as Draft" text link in the header.
1. **Step 1 – Route:** "Pickup point" and "Destination" address-search fields with a small map preview, plus a segmented control for "Journey Scale" (Urban Route / Intercity Route).
2. **Step 2 – Schedule:** date picker and time picker for departure, and a seat-count stepper ("Available seats").
3. **Step 3 – Vehicle:** a list of the host's saved vehicles as selectable cards (photo, make/model, plate), plus an "Add new vehicle" option.
4. **Step 4 – Trip Details:** a text field for "Non-monetary contribution requirements," a multi-select chip group for "Trip restriction tags" (Pet-friendly, No smoking, Women-only, etc.), and an "Add culinary/cultural waypoint" button that opens an inline list of added waypoints (name + map pin), each removable.
5. **Step 5 – Review & Publish:** a summary card recapping all entered info, with two buttons at the bottom — secondary "Save as Draft" and primary green "Publish Ride."

### Screen 4 — My Ride Requests (passenger view)
**Covers:** FR-2.5, FR-2.10
**Prompt:**
Design a screen listing the current user's submitted ride requests as cards, each showing the route, date, a status pill (Pending / Accepted / Rejected / Cancelled), and the host's name. Tapping a card opens a detail sheet with full ride info and, if the request is still Pending or Accepted, a red "Cancel Request" button. Tapping it opens a bottom sheet asking the user to select or type a cancellation reason, with a "Confirm Cancellation" button.

### Screen 5 — Manage Ride Requests (host view)
**Covers:** FR-2.6, FR-2.7
**Prompt:**
Design a screen (accessed from a host's own ride via "Manage Requests") listing all requests submitted for that ride. Each row/card shows the requesting passenger's avatar, name, reputation score, and a request timestamp, with two inline buttons: green "Accept" and outlined red "Reject." Accepted requests move to an "Accepted" section at the top; rejected ones move to a collapsed "Rejected" section at the bottom.

### Screen 6 — Edit Ride
**Covers:** FR-2.8
**Prompt:**
Design an "Edit Ride" screen reusing the Step 4 layout from the Publish flow (contribution requirements, restriction tags, culinary/cultural waypoints) plus the journey-scale selector — these are the only fields editable before a ride is matched. Show a locked/disabled state with a small note ("This ride has already been matched and can no longer be edited") if the ride status is Matched or later.

### Screen 7 — Cancel Published Ride (host)
**Covers:** FR-2.11
**Prompt:**
Design a confirmation modal/bottom sheet triggered from a host's ride detail screen: a warning icon, the text "Cancelling this ride will notify all passengers with accepted requests," a required "Reason for cancellation" text field, and two buttons — a neutral "Go Back" and a solid red "Cancel Ride."

### Screen 8 — Rate & Review
**Covers:** FR-2.12
**Prompt:**
Design a post-trip screen shown once a ride's status is Completed: the other party's avatar and name at the top, a 5-star rating selector, a text area for a written review, and a green "Submit Review" button.

---

## 5. Screens to Keep Non-Functional (other nav tabs)

For **Home, Search, Message, Favourite, Profile**, design only a simple, static placeholder so the nav bar demo is complete, without building out their real functionality:
- A centered icon (reuse the tab's nav icon, larger and light gray) and a short label like "Coming soon" or "[Tab name] — not yet available in this prototype."
- Keep the nav bar itself fully visible and tappable on these screens; only the content area is a stub.

---

## 6. Delivery notes
- Frame naming: prefix with the tab, e.g. `Ride / 01 – Ride Hub`, `Ride / 02 – Ride Detail`, etc.
- Prototype connections: Ride Hub → Ride Detail → Request/Manage flows; FAB → Publish flow → back to Ride Hub on publish.
- Keep the nav bar as a shared component/instance across all frames so switching tabs is demonstrable, even though only "Ride" leads to real screens.
