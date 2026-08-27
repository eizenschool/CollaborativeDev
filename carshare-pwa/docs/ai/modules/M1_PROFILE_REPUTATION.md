# Module 1 — User Profile & Reputation

## Owner
Daniel Lim Dong Hen

## Purpose
User identity/profile, vehicle information, reputation/impact presentation, emergency-contact/account-management responsibilities.

## Requirement Intent
Registration/profile management, photo, vehicles, reputation/level, public profile, host eligibility support, Host Impact Score/badge presentation, emergency contact, deactivation/deletion. Some scoring formulas/thresholds remain unresolved and should not be silently invented.

## Existing Repository Areas
Presentation: `AuthPage.jsx`, `MyProfile.jsx`, `MyVehicles.jsx`, `ProfileSettings.jsx`, `Reputation.jsx`, `HostDashboard.jsx`, `Sidebar.jsx`.
Business logic: `AuthService.js`, `ProfileService.js`, `VehicleService.js`, `HostImpactEngine.js`.
Shared: `AuthContext.jsx`, `supabaseClient.js`, `mockDataStore.js`.

## Owns
Profile/account-facing behaviour, vehicles, profile-side reputation/impact display, host eligibility inputs exposed to Module 2.

## Depends On
Module 6 trust/verification outcomes; Module 5/other trip data for some impact metrics; Supabase Auth/profile data.

## Current Status
`Development` already contains a substantial Module 1 prototype and services. Do not restart from scratch.
Auth and Profile now consume the shared semantic UI runtime: visible labels,
inline live feedback, pending submission states, accessible account actions,
adaptive deactivation confirmation, and the phone Sign out path are preserved
without adding profile fields or changing authentication/service contracts.
Module 1 is connected to the shared Supabase project. The deployed history is
`database/sql/001-012`; security corrections for Module 1 are in `008-009`.
Supabase session restoration now has one startup authority: AuthContext consumes
the user supplied by `INITIAL_SESSION`, mounts a safe account shell immediately,
and fetches the private Profile in the background. Initial `Preparing` is capped
at eight seconds with a non-blocking retry notice; foreground token/profile
events stay silent and never replace the mounted route with the startup screen.
Public-safe profile fields are separate from owner-only phone/emergency data,
email is sourced from Supabase Auth, avatars use an owner-folder policy, and
vehicles are owner-only with one active vehicle per user. Email verification
does not establish an app session until Supabase returns one. Deactivation is
reversible on the next successful login and hides published rides; hard account
deletion is hidden until Auth identity deletion can be implemented safely.
`MyProfile.jsx`'s consolidated layout (`.profile-page`/`.profile-sidebar`/`.rail-card` in `theme.css`) now has a `@media (max-width: 700px)` breakpoint matching Module 2's Ride Hub pattern - previously the sidebar had no mobile treatment.
Module 2 reviews now recalculate `host_impact_stats.rating` as the account-level
average star rating. They intentionally do not alter `reputation_score` or the
unconfirmed Host Impact formula.
`AuthPage.jsx` now offers "Continue with Google" next to email/password (D015);
`AuthService.signInWithGoogle()` calls Supabase's `signInWithOAuth`, and the
existing `handle_new_user()` trigger already covers Google's profile/avatar
metadata shape. Still needs Google Cloud + Supabase Dashboard provider setup
(see `docs/SUPABASE-SETUP.md`) before it works against the live project.
Sign-up now also validates a Malaysian IC (MyKad) number format
(`AuthService.validateMalaysianIC`) as an identity gate before an account can
be created; the value is never persisted or sent to Supabase - format check
only. Adding a vehicle now also requires a driver's license number
(`vehicles.driver_license_number`, `database/sql/016`), an input-capture
eligibility gate rather than a verified Module 6 check.
`/home` is now the public website entry rather than a post-login-only route.
Guests can browse Home, Search, Ride listings, and Published Ride Detail; the
shared auth gate is applied only when they enter account-specific services.
`AuthPage.jsx` defaults to Login for a gated action, explains why authentication
is needed, and returns email/password users to the requested internal route.
Its journey scene remains a desktop treatment and is hidden on phone, where the
form is the complete auth experience. The desktop car follows the full KL
Sentral-Genting-Ipoh route using the route's SVG geometry.
Profile exposes an explicit Sign out action after the page content on phone
because the desktop top-navigation actions are hidden below 700px.
Profile's Overview panel continues to omit the redundant Quick actions card
because Home owns primary navigation.
When `VITE_M2_SOS_ENABLED=true`, Info & Security also hosts Module 2's Trusted
Family card. It lists only the account owner's outgoing one-way relationships,
shows whether each recipient has at least one Push-ready device, creates a
hashed one-use 24-hour invitation, and requires confirmation before revocation.
The card never exposes Push endpoints or grants ordinary location access;
Module 2 owns the service and database contract.
Module 4's reviewed-but-undeployed migration `039` adds optional owner-managed
classification fields: one `vehicles.vehicle_type` per vehicle and a set of
`profiles.spoken_languages` for the Host. The profile and vehicle screens and
mock adapter support these fields now. Existing rows are intentionally not
backfilled, and the live save actions report the deployment requirement until
`036` is reviewed and applied. These classifications are the only new fields
allowed into Module 4's public card projection; vehicle make/model/plate and
other private profile data remain owner-only.

## Open Questions
Reputation formula/weights; Host Impact formula; badge/publishing thresholds;
hard account deletion; phone OTP.
