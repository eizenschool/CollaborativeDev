# Module 3 — Messaging

## Owner
Chong Zheng Zhe

## Purpose
Supabase-backed ride communication for UC3.4, UC3.7, and UC3.8.

## Implemented Contract

- A signed-in non-Host can create or reuse one direct chat for a Published ride from Ride Detail; acceptance is not required.
- Accepting the first ride request creates the ride's one group chat in the same transaction and adds the Host plus accepted account holder. Later accepted account holders join that group. Companion names never become members.
- A normal user message is one atomic bundle containing any non-empty combination of up to 1,000 text characters, 10 mixed images/videos, and one current GPS location.
- Images: JPEG/PNG/WebP, 10 MB each. Videos: MP4/WebM/QuickTime, 50 MB each. Combined media: 100 MB per message.
- The composer camera action sits beside the file action. It opens a bottom sheet on mobile and an anchored menu on desktop. On mobile, `Take photo` delegates to the operating-system camera through a capture-enabled file input; on desktop, it uses an in-page HTTPS `getUserMedia` preview and captures a JPEG frame. `Record video` stays inside the HTTPS page and uses `getUserMedia` plus `MediaRecorder`; mobile users choose either the front or main (rear) camera before recording, while desktop goes straight to its available front camera. It prefers H.264/AAC MP4 for cross-device playback and falls back to WebM only where necessary, then adds the stopped recording to the existing media draft. The normal file action remains the fallback for unsupported browsers.
- A voice message is a standalone 1-180 second audio attachment limited to 10 MB. Browser `MediaRecorder` manages the recording lifecycle while Web Audio captures a 16 kHz mono PCM WAV playback-safe fallback (about 5.8 MB at three minutes) for Chromium/Electron environments whose WebM output lacks usable media metadata. WebM, MP4, Ogg, and WAV are accepted. Recording is stopped automatically at three minutes; stopped recordings remain as in-memory drafts for preview, retry, or deletion.
- Rendering order for normal bundles is text, ordered media grid, then Google Maps Embed `place` mode. Location is coordinates only; no geocoding. Voice messages render with native audio controls and use `Voice message` in list/history summaries.
- The original sender can atomically edit a complete normal bundle only before another member reads it. Voice messages cannot be edited. The sender can delete either message form regardless of read state. Deleted messages remain as tombstones.
- History is oldest-to-newest and searches text, system messages, and media filenames. Results safely highlight the keyword and jump back to the original message.
- Completed direct chats can be archived independently by each user and become read-only with no unarchive. A Completed group can be left only by a traveller; the Host cannot leave. Remaining members receive a Realtime system message.
- Completed, Cancelled, and Expired rides retain their conversations for seven days, then RLS removes all access.

## Architecture

- Presentation: `src/presentation/components/messaging/` and routes `/message`, `/message/:conversationId`, `/message/:conversationId/history`. `useVideoRecorder.js` owns in-page camera permission, supported MP4/WebM selection, the 50 MB stop guard, and camera-track cleanup.
- Business logic: `src/business-logic/MessagingService.js` validates bundles and standalone voice messages, coordinates uploads, maps `messageTypes`, and keeps failed drafts retryable. `src/presentation/components/messaging/useVoiceRecorder.js` owns microphone permission, MIME selection, timing, track shutdown, and unmount cleanup.
- Data access: `src/data-access/supabaseMessagingRepository.js` is the production adapter for PostgREST RPC, Realtime, and private Storage signed URLs.
- Database: `database/sql/016_m3_supabase_messaging.sql`; `017_m3_advisor_followup.sql` covers the direct-user foreign key; `018_m3_versioned_media_paths.sql` finalizes sender/conversation/message/version object paths; `025_m3_add_voice_messages.sql` adds private standalone audio attachments and their duration contract; `026_m3_add_wav_voice_fallback.sql` adds the playback-safe WAV fallback.
- The previous `localMessagingStore.js` and dummy message data are legacy-only and are no longer imported by the production Module 3 path.

## Security Boundary

Clients receive SELECT-only grants on messaging tables. All mutations use narrow authenticated `SECURITY DEFINER` RPCs with empty search paths, `auth.uid()` ownership/membership checks, lifecycle checks, and row locks. The `message-media` bucket is private: uploads are owner/conversation staged, listing is blocked, and downloads require a current visible attachment row.

## Deferred

Phone/WebRTC calling, telephone-number access, translation/UC3.6, push/email notifications, hazard advisories, address geocoding, and map point selection. Two-account cross-browser manual acceptance plus physical-device camera/microphone checks remain required before a release sign-off.
