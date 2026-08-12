# Module 3 — Messaging

## Owner
Chong Zheng Zhe

## Purpose
Supabase-backed ride communication for UC3.4, UC3.7, and UC3.8.

## Implemented Contract

- A signed-in non-Host can create or reuse one direct chat for a Published ride from Ride Detail; acceptance is not required.
- Accepting the first ride request creates the ride's one group chat in the same transaction and adds the Host plus accepted account holder. Later accepted account holders join that group. Companion names never become members.
- A user message is one atomic bundle containing any non-empty combination of up to 1,000 text characters, 10 mixed images/videos, and one current GPS location.
- Images: JPEG/PNG/WebP, 10 MB each. Videos: MP4/WebM/QuickTime, 50 MB each. Combined media: 100 MB per message.
- Rendering order is text, ordered media grid, then Google Maps Embed `place` mode. Location is coordinates only; no geocoding.
- The original sender can atomically edit the complete bundle only before another member reads it. The sender can delete the complete bundle regardless of read state. Deleted messages remain as tombstones.
- History is oldest-to-newest and searches text, system messages, and media filenames. Results safely highlight the keyword and jump back to the original message.
- Completed direct chats can be archived independently by each user and become read-only with no unarchive. A Completed group can be left only by a traveller; the Host cannot leave. Remaining members receive a Realtime system message.
- Completed, Cancelled, and Expired rides retain their conversations for seven days, then RLS removes all access.

## Architecture

- Presentation: `src/presentation/components/messaging/` and routes `/message`, `/message/:conversationId`, `/message/:conversationId/history`.
- Business logic: `src/business-logic/MessagingService.js` validates bundles, coordinates uploads, maps `messageTypes`, and keeps failed drafts retryable.
- Data access: `src/data-access/supabaseMessagingRepository.js` is the production adapter for PostgREST RPC, Realtime, and private Storage signed URLs.
- Database: `database/sql/016_m3_supabase_messaging.sql`; `017_m3_advisor_followup.sql` covers the direct-user foreign key; `018_m3_versioned_media_paths.sql` finalizes sender/conversation/message/version object paths.
- The previous `localMessagingStore.js` and dummy message data are legacy-only and are no longer imported by the production Module 3 path.

## Security Boundary

Clients receive SELECT-only grants on messaging tables. All mutations use narrow authenticated `SECURITY DEFINER` RPCs with empty search paths, `auth.uid()` ownership/membership checks, lifecycle checks, and row locks. The `message-media` bucket is private: uploads are owner/conversation staged, listing is blocked, and downloads require a current visible attachment row.

## Deferred

Translation/UC3.6, push/email notifications, hazard advisories, address geocoding, and map point selection. Two-account cross-browser manual acceptance remains required before a release sign-off.
