# Figma Prompt — Fix Desktop Layouts Only (Module 1)

> **Implementation authority:** This is a Figma/design reference. For repository
> implementation, read `docs/ai/UI.md` first; it is the current shared UI/UX
> contract and takes precedence when this prompt is outdated.

## Scope — read this first
- **Do not touch any mobile frame.** The mobile versions are correct — leave them exactly as they are.
- Only rebuild the **desktop/web frame** for each screen. Keep the same colors, typography, copy, and content already generated — this is a **layout restructuring pass**, not a re-brand or re-write.
- Work through this one screen at a time: select that screen's desktop frame in Figma, then paste that screen's block below. Pasting one screen at a time gets more reliable results than pasting the whole document at once.
- This applies to the **Profile** module's 7 screens only (Sign Up, Login, Profile Hub, Info & Security, My Vehicles, Reputation & Impact, Account Settings). The Ride module's desktop fixes are handled in a separate document — don't touch those frames here.

### Reusable opening line
Paste this line before each screen block, or once at the top if your tool takes one long prompt:

> "Rebuild only the desktop/web frame for this screen so it looks like a real desktop web app, not the mobile frame stretched or centered on a wider canvas. Do not change the mobile frame. Keep the existing colors, typography, and content — this is a layout-only fix."

---

## Applies to every desktop frame: the top nav bar
Every desktop frame should use a full-width, sticky top navigation bar (white, ~72px tall, bottom border) instead of the bottom tab bar: logo/app name on the left, the 6 nav items (Home, Search, Ride, Message, Favourite, Profile) as horizontal icon+label pills in the center-left with **"Profile" shown active** (light green pill), and a notification bell + profile avatar on the right. Page content sits directly below it, full browser width, max-width ~1280–1440px centered, not inside a narrow floating card. Reuse the exact same nav bar component already fixed for the Ride module's desktop frames — it should be pixel-identical apart from which item is active.

---

## Screen 1 — Sign Up (desktop)
This should be a split-screen layout, not a centered mobile-width card floating on a wide background: left half (~45–50% width) is a branded panel — soft green gradient or the app's brand illustration/route graphic, logo, and a short tagline; right half is a centered form column (max-width ~420px) with the Full Name, Email, Phone, Password, Confirm Password fields stacked, the "Create Account" button, and the "Log in" link. Both halves fill the full viewport height.

## Screen 2 — Login (desktop)
Same split-screen treatment as Sign Up for visual consistency: branded panel on one side, centered form column (Email, Password, "Forgot password?" link, "Log In" button, "Sign up" link) on the other. Reuse the same brand panel content/illustration used in Screen 1 so the two feel like one flow.

## Screen 3 — Profile Hub (desktop)
Two-column layout below the top nav: left column (~280–320px, sticky on scroll) is the section rail — Overview / Info & Security / My Vehicles / Reputation & Impact — shown as a vertical list with the active section highlighted (light green background, green text/icon), sitting just below a condensed version of the hero band (avatar, name, tier badge). Right column is the wide content panel showing whichever section is selected (Overview by default: stat cards in a horizontal row rather than stacked, emergency contact quick-view card, log-out link at the bottom of the rail).

## Screen 4 — Info & Security (desktop)
Single centered content panel (max-width ~700–800px) within the right-hand content area from Screen 3's layout. Fields that were stacked full-width on mobile (Full Name / Email / Phone) become a two-column row where sensible. The "Change Password" card and the "Emergency Contacts" list sit below as their own full-width sections within that same centered panel, not separate screens. The "Add Emergency Contact" form opens as an inline modal (centered, dimmed backdrop) instead of a bottom sheet.

## Screen 5 — My Vehicles (desktop)
Vehicle cards laid out in a grid (2–3 columns depending on panel width) instead of a single stacked list, each card with more internal padding so the photo, make/model, plate, and edit/delete icons sit comfortably. "Add Vehicle" opens as a centered modal form (~480–560px wide) rather than a full mobile-width form screen. The host auto-elevation banner, when triggered, appears as a dismissible banner at the top of the grid rather than a full-screen takeover.

## Screen 6 — Reputation & Impact (desktop)
Two-column layout within the content panel: left column holds the large reputation-score progress ring and tier badge; right column holds the Composite Host Impact Score chart (donut/stacked bar with the three labeled segments) and the stat row (trips hosted, trips joined, no-shows, carbon saved) below it as a small grid of stat cards instead of a stacked list.

## Screen 7 — Account Settings (desktop)
Single centered panel (max-width ~600–700px) listing "Deactivate Account" and "Delete Account" as two clearly separated rows/cards with their explanatory text beside (not below) each action button. Confirmation prompts appear as a centered modal dialog (~480px wide) on a dimmed backdrop, vertically centered in the viewport — not a full-width bottom sheet like on mobile.

## Placeholder screens — Home, Search, Message, Favourite (desktop)
Keep the top nav bar; center the placeholder icon and "Coming soon" label in the full content area below it (not a small mobile-width block floating in the middle of a wide empty page).

---

## Quick checklist while reviewing each result
- Nav bar is a top bar, not a bottom tab bar, and matches the Ride module's nav bar exactly except for the active item.
- No narrow white card floating in a sea of gray background — content uses the real page width.
- List/browse screens (My Vehicles) use a grid, not a single stacked column.
- Forms/modals use sensible fixed or max-widths instead of stretching full-bleed.
- The mobile frame for that screen is unchanged.
