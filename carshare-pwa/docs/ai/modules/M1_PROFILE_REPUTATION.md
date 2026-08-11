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

## Open Questions
Reputation formula/weights; Host Impact formula; badge/publishing thresholds; emergency-contact email mismatch; phone OTP production infrastructure.
