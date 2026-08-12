# Figma Prompt — Fix Desktop Layouts Only (Module 2)

> **Implementation authority:** This is a Figma/design reference. For repository
> implementation, read `docs/ai/UI.md` first; it is the current shared UI/UX
> contract and takes precedence when this prompt is outdated.

## Scope — read this first
- **Do not touch any mobile frame.** The mobile versions are correct — leave them exactly as they are.
- Only rebuild the **desktop/web frame** for each screen. Keep the same colors, typography, copy, and content already generated — this is a **layout restructuring pass**, not a re-brand or re-write.
- Work through this one screen at a time: select that screen's desktop frame in Figma, then paste that screen's block below. Pasting one screen at a time gets more reliable results than pasting the whole document at once.

### Reusable opening line
Paste this line before each screen block, or once at the top if your tool takes one long prompt:

> "Rebuild only the desktop/web frame for this screen so it looks like a real desktop web app, not the mobile frame stretched or centered on a wider canvas. Do not change the mobile frame. Keep the existing colors, typography, and content — this is a layout-only fix."

---

## Applies to every desktop frame: the top nav bar
Every desktop frame should use a full-width, sticky top navigation bar (white, ~72px tall, bottom border) instead of the bottom tab bar: logo/app name on the left, the 6 nav items (Home, Search, Ride, Message, Favourite, Profile) as horizontal icon+label pills in the center-left with "Ride" shown active (light green pill), and a notification bell + profile avatar on the right. Page content sits directly below it, full browser width, max-width ~1280–1440px centered, not inside a narrow floating card.

---

## Screen 1 — Ride Hub (desktop)
Two-column layout below the top nav: left column (~320–360px, sticky on scroll) holds the "Find a Ride / My Rides" toggle, the search form, and a normal "Publish a Ride" button (not the round mobile FAB). Right column holds a "X rides available / Filters" header row followed by ride result cards in a 2-column grid, each card widened with more internal padding so host info, tags, and the contribution badge sit comfortably on one row.

## Screen 2 — Ride Detail (desktop)
Two-column layout, roughly 65/35 split: left column holds the large map header, trip info, the lifecycle stepper, the route-lock notice, and the Culinary & Cultural Waypoints row; right column is a sticky panel (starts level with the map, stays in view while scrolling) containing the host card and the primary action buttons ("Request to Join," or "Edit Ride" / "Manage Requests" for the host). This mirrors a typical listing-page pattern — content on the left, a sticky action panel on the right — instead of everything stacked full-width in one column.

## Screen 3 — Publish a Ride (desktop)
Replace the top progress-dot stepper with a vertical step list on the left (Route, Schedule, Vehicle, Trip Details, Review), each step's form content shown on the right in a centered panel (max-width ~700–800px). Fields that were stacked full-width on mobile (e.g., Pickup/Destination, Date/Time) become side-by-side two-column rows. "Save as Draft" stays as a header-level link; the step navigation buttons sit at the bottom of the right-hand panel.

## Screen 4 — My Ride Requests (desktop)
Master-detail layout: a request list in a left column (~360–400px), each row showing route, date, and status pill; selecting a request shows its full detail — including the "Cancel Request" button and reason field — in a panel on the right, replacing the mobile bottom sheet. No request selected = right panel shows an empty state ("Select a request to see details").

## Screen 5 — Manage Ride Requests (desktop)
Present requests as a table rather than stacked cards: column headers for Passenger, Reputation, Requested, and Actions; each request is a row with inline green "Accept" / outlined red "Reject" buttons at the row's right edge. Accepted and Rejected requests split into two tabs or collapsible sections above the table instead of stacking vertically.

## Screen 6 — Edit Ride (desktop)
Single centered form panel (max-width ~700–800px, no stepper needed since it's one step), with the contribution-requirement field, restriction-tag chips, and waypoint list laid out in a two-column grid where it makes sense (e.g., journey-scale selector beside restriction tags). If the ride is already Matched, show the locked/disabled state as a banner at the top of this same panel rather than a separate mobile-style notice screen.

## Screen 7 — Cancel Published Ride (desktop)
This should be a centered modal dialog (~480px wide) on a dimmed backdrop, vertically centered in the viewport — not a full-width bottom sheet like on mobile. Warning icon, message, reason field, and the "Go Back" / "Cancel Ride" buttons all stay inside that fixed-width modal.

## Screen 8 — Rate & Review (desktop)
Same treatment as Screen 7: a centered modal/card (~480–560px wide) on a dimmed backdrop, vertically centered, containing the avatar, star rating, review text area, and "Submit Review" button — not stretched full-width.

## Placeholder screens — Home, Search, Message, Favourite, Profile (desktop)
Keep the top nav bar; center the placeholder icon and "Coming soon" label in the full content area below it (not a small mobile-width block floating in the middle of a wide empty page).

---

## Quick checklist while reviewing each result
- Nav bar is a top bar, not a bottom tab bar.
- No narrow white card floating in a sea of gray background — content uses the real page width.
- List/browse screens use a grid or table, not a single stacked column.
- Forms/modals use sensible fixed or max-widths instead of stretching full-bleed.
- The mobile frame for that screen is unchanged.
