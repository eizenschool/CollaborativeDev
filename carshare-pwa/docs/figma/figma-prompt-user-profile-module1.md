# Figma Design Prompt — User Profile & Reputation PWA (Module 1 Focus)

## How to use this document
- **Implementation authority:** This is a Figma/design reference. For repository
  implementation, read `docs/ai/UI.md` first; it is the current shared UI/UX
  contract and takes precedence when this prompt is outdated.
- Paste the **Design System** section once into your AI design tool (Figma "First Draft"/AI features, Uizard, Galileo AI, v0, etc.) so it's used as shared context, then paste each **screen prompt** one at a time.
- If your tool accepts one long brief, you can paste the whole document in one go.
- Replace **[App Name]** with the actual project name ("Let's Tumpang") throughout.
- Only the **Profile** tab and its screens (Module 1) need to be fully functional/hi-fi here. The **Ride** tab is already built (Module 2, separate document) and should be treated as done, not redesigned. Everything else stays a static placeholder — this is called out explicitly in Section 5.
- **Design-system note:** this document reuses the exact same green theme, typography, nav bar, and component styling as the Module 2 "Ride-Sharing PWA" prompt, since the nav bar is a shared, persistent element across every module and the team is building one consistent Figma file. Your existing coded Module 1 prototype (`carshare-pwa`) currently uses a different navy/teal palette with Fraunces + Manrope fonts — if you want the Figma mockups to match that instead of the shared green system, swap the tokens in Section 2 before pasting.

---

## 1. App Overview (context for the AI tool)

**[App Name]** is a Progressive Web App (PWA) for community ride-sharing, usable on both mobile phones (installable, app-like) and desktop web browsers. Hosts publish rides with a fixed route, available seats, non-monetary contribution requirements, and optional cultural/culinary waypoints along the way. Passengers search for rides, request to join, and message hosts once accepted. The app also tracks eco-impact (carbon savings) and a reputation/trust system.

**For this design pass we are only building the navigation bar and the full "Profile" module (registration, login, profile management, vehicle management, reputation & Host Impact Score, emergency contacts, and account settings).** The Ride tab is already fully designed separately; all remaining sections exist only as placeholders.

Tone: clean, trustworthy, community-driven, eco-conscious. Think "Airbnb meets BlaBlaCar," with a fresh green identity.

---

## 2. Design System

### Platform & responsive behavior
- Mobile-first PWA. Design two frame sets per screen:
  - **Mobile:** 375 × 812 (iPhone-sized), bottom tab bar navigation.
  - **Web/Desktop:** 1440 × 1024, top navigation bar, content reflows into a wider layout.
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
| Warning | `#F59E0B` | Warnings, below-threshold reputation states |
| Error | `#EF4444` | Errors, destructive actions (delete vehicle, deactivate account) |
| Info | `#3B82F6` | Informational badges |

**Reputation tier colors** (used throughout Module 1, mirrors the Module 2 status-color convention):

| Tier | Score Range | Text/Icon Color | Background |
|---|---|---|---|
| Bronze | < 50 | `#92400E` | `#FEF3C7` |
| Silver | 50 – 79 | `#6B7280` | `#F3F4F6` |
| Gold | ≥ 80 | `#CA8A04` | `#FEF9C3` |

**Reputation threshold indicator:** the platform-wide minimum reputation score to publish a ride is 60/100 (admin-configurable). At/above threshold, show the score in Primary Green; below threshold, show it in Warning amber with a small explanatory note.

**Composite Host Impact Score breakdown colors** (for the score's 3-part composition — 40% trip count, 30% carbon savings, 30% reputation): Trip Count segment in Primary Green `#16A34A`, Carbon Savings segment in Secondary Teal `#0D9488`, Reputation segment in Info Blue `#3B82F6`.

### Typography
- Headings: **Poppins**, SemiBold/Bold (H1 24/32px, H2 20/28px, H3 16/24px)
- Body/UI: **Inter**, Regular/Medium (Body 14–15px, Caption/label 12px, Button label 14px Medium)

### Components style
- Corner radius: 16px on cards, 12px on buttons/inputs, full-pill (999px) on chips/tags, 24px on bottom-sheet top corners.
- Shadows: soft, e.g. `0px 2px 8px rgba(0,0,0,0.06)` on cards; slightly stronger on bottom sheets and modals.
- Spacing: 8px base grid; 16px screen padding on mobile, 24–32px on web.
- Icons: outline/line style, 24px, ~1.75px stroke (Feather/Lucide-style); active/filled variant for the selected nav icon.
- Buttons: Primary (solid green, white text), Secondary (white bg, green border/text), Destructive (red text/border or solid red for confirm-deactivate/delete actions).

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
- **Active state** (Profile tab, since that's what we're building here): filled icon/avatar ring + label in Primary Green `#16A34A`.
- **Inactive state** (Home, Search, Message, Favourite): outline icon + label in Text Secondary `#6B7280`, leading to placeholder screens (Section 5). **Ride** is also inactive-styled here but leads to the already-built Module 2 screens — do not redesign it.

### Web/Desktop — top nav bar
- Fixed top bar, height ~72px, white surface, bottom border/shadow.
- Left: logo/app name.
- Center-left: the same 6 items as horizontal icon+label pills; the active "Profile" item has a Primary Green Tint (`#DCFCE7`) pill background and green text/icon.
- Right: notification bell icon, profile avatar with dropdown chevron (this can be the same avatar as the Profile nav item).
- Between 768–1024px, collapse labels and show icon-only with tooltips on hover.

---

## 4. Screens to Design in Full — Module 1: User Profile & Reputation

These are the screens that should be fully fleshed out, hi-fi, with real components and states. Each includes both a mobile and web frame.

### Screen 1 — Sign Up
**Covers:** account registration, including the Email field (FR-1.10) needed downstream by Module 6's WhatsApp deep-link feature.
**Prompt:**
Design a sign-up screen: app logo/wordmark at top, a form with Full Name, Email, Phone Number, Password, and Confirm Password fields, a Terms & Conditions checkbox, and a primary green "Create Account" button. Below the button, a text link "Already have an account? Log in." Keep the layout centered and uncluttered, mint-gray background, white form card with 16px corner radius.

### Screen 2 — Login
**Covers:** authentication entry point.
**Prompt:**
Design a login screen: logo, Email and Password fields, a "Forgot password?" text link right-aligned under the password field, a primary green "Log In" button, and a "Don't have an account? Sign up" link at the bottom. Mirror the Sign Up screen's visual treatment for consistency.

### Screen 3 — Profile Hub (Profile tab home)
**Covers:** the main landing screen for the Profile tab — profile overview, entry points into vehicles/reputation/security.
**Prompt:**
Design the landing screen for the "Profile" tab. A hero band at the top shows the user's avatar (large, editable via a small camera-icon overlay), full name, and a compact reputation summary — current score out of 100 and their tier badge (Bronze/Silver/Gold, styled per the tier color table above). Below the hero band, an in-page section rail/tab strip with four sections: **Overview**, **Info & Security**, **My Vehicles**, **Reputation & Impact**. The Overview panel (default) shows: a summary card with member-since date, host status ("Passenger" or "Host"), and quick stats (rides hosted, rides joined); an emergency contact quick-view card; and a "Log Out" text button at the bottom. Each section rail item routes to the corresponding screen below (Screens 4–6).
- On web: the section rail becomes a sticky left sidebar (~280px) alongside the hero band; the selected panel's content fills the remaining width.

### Screen 4 — Info & Security
**Covers:** editable personal info, password change, emergency contact management.
**Prompt:**
Design the "Info & Security" panel. An editable form section for Full Name, Email, Phone Number, with a green "Save Changes" button. A separate "Change Password" card with Current Password, New Password, Confirm New Password fields and its own "Update Password" button. Below that, an "Emergency Contacts" list — each contact as a row card (name, relationship, phone number, small edit/delete icon buttons) with an "Add Emergency Contact" button/link that opens a small form (Name, Relationship, Phone Number fields) in a bottom sheet (mobile) or inline modal (web).

### Screen 5 — My Vehicles
**Covers:** vehicle management, auto-elevation to Host role on first vehicle registration.
**Prompt:**
Design the "My Vehicles" panel. A list of the user's saved vehicles as cards (vehicle photo/placeholder icon, make/model, plate number, color, small edit/delete icon buttons). An "Add Vehicle" button opens a form (Make, Model, Plate Number, Color, optional Photo upload) with a primary green "Save Vehicle" button. When a user adds their very first vehicle, show a celebratory inline banner or modal: "You're now a Host! You can publish rides." with a Secondary Teal accent, since this is the auto-elevation trigger. Empty state (no vehicles yet): a centered illustration/icon, "No vehicles added yet" text, and the "Add Vehicle" button.

### Screen 6 — Reputation & Impact
**Covers:** reputation score, minimum-threshold indicator, Composite Host Impact Score, tier badge.
**Prompt:**
Design the "Reputation & Impact" panel. At the top, a large circular progress ring showing the Reputation Score out of 100 (ring in Primary Green if at/above the 60-point publish threshold, in Warning amber with a small note "Minimum 60 required to publish rides" if below). Beside/below it, the tier badge (Bronze/Silver/Gold) styled per the tier color table, with a short caption of what the tier unlocks. Below that, a "Composite Host Impact Score" card showing a horizontal stacked bar or donut chart broken into three labeled segments — Trip Count (40%, Primary Green), Carbon Savings (30%, Secondary Teal), Reputation (30%, Info Blue) — with the overall composite score as a large number above the chart. A small info icon/tooltip explains the weighting. Below that, a brief history list or small stat row: total trips hosted, total trips joined, no-show count, total carbon saved (kg CO₂).

### Screen 7 — Account Settings
**Covers:** account deactivation/deletion.
**Prompt:**
Design an "Account Settings" screen (reached from Overview or Info & Security) listing account-level actions: "Deactivate Account" (secondary/outlined button) and "Delete Account" (destructive red text/button), each with a one-line explanation of what it does. Tapping either opens a confirmation modal/bottom sheet: warning icon, explanatory text (e.g., "Deactivating hides your profile and pauses ride hosting until you log back in" / "Deleting your account permanently removes your data and cannot be undone"), a required reason text field for deletion only, and two buttons — neutral "Go Back" and solid red "Confirm."

---

## 5. Screens to Keep Non-Functional (other nav tabs)

For **Home, Search, Message, Favourite**, design only a simple, static placeholder so the nav bar demo is complete, without building out their real functionality:
- A centered icon (reuse the tab's nav icon, larger and light gray) and a short label like "Coming soon" or "[Tab name] — not yet available in this prototype."
- Keep the nav bar itself fully visible and tappable on these screens; only the content area is a stub.

**Ride** is not a placeholder — it's already fully designed in the separate Module 2 document. Don't recreate it here; just make sure the shared nav bar component links to it correctly.

---

## 6. Delivery notes
- Frame naming: prefix with the tab, e.g. `Profile / 01 – Sign Up`, `Profile / 02 – Login`, `Profile / 03 – Profile Hub`, etc.
- Prototype connections: Sign Up ↔ Login → Profile Hub → Info & Security / My Vehicles / Reputation & Impact (via section rail); My Vehicles "Add Vehicle" → Host auto-elevation banner; Overview → Account Settings → confirmation modal.
- Keep the nav bar as a shared component/instance across all frames — reuse the exact same nav bar component your teammate built for the Module 2 (Ride) frames so it stays visually identical across the whole Figma file, just with "Profile" as the active state instead of "Ride."
