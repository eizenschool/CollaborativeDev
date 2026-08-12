# Module 3 — Messaging

## Owner
Chong Zheng Zhe

## Purpose
Trip-bound communication between hosts and accepted travellers.

## Requirement Intent
Text/image/video, location sharing, conversation list/history, sender/timestamp/type, notifications, hazard advisories, translation, edit-before-read, realtime, delete, archive/leave.

## Existing Repository Areas
Presentation: `src/presentation/components/messaging/` including `MessageModule.jsx`, `ConversationList.jsx`, `ChatWindow.jsx`, `MessageBubble.jsx`, `TripInfoSidebar.jsx`.
Business logic: `src/business-logic/MessagingService.js`.
Local demo data adapter: `src/data-access/localMessagingStore.js`.
Styles: `src/presentation/styles/message.css`.

## Depends On
Module 2 accepted ride/participation; Module 6 hazard advisories; translation provider; Supabase Realtime/Storage if selected.

## Current Status
Core text messaging is implemented as a local demo: private and group
conversations, message history, unread counts, latest-message sorting, and
same-origin browser-tab updates. State is versioned in `localStorage`, so it
survives page refreshes. This is not cross-device or production realtime.

## Module 2 Contract

When an accepted-passenger list changes, Module 2 should call:

```js
await MessagingService.syncAcceptedRideConversations({
  ride,
  host,
  passengers,
});
```

`ride` must include `id`; `pickup`, `destination`, `date`, and `time` are used
when available. `host` and each accepted passenger must include `id` and one of
`fullName`, `name`, `user_metadata.full_name`, or `email`; `profilePhotoUrl` is
optional. The operation is idempotent: every accepted passenger receives one
host-private chat, a group is created only once there are two passengers, and
later accepted passengers are added to that same group. Module 2 does not need
to store conversation IDs.

## Current Limitations

- Realtime means local `BroadcastChannel` plus the `storage` event between
  same-origin browser tabs only; replace the local adapter with Supabase
  persistence and Realtime for cross-device communication.
- This pass supports text messages only. Media, location, translation, hazard
  advisories, edit/delete, archive/leave, and push notifications remain future
  work.

## Open Questions
Supabase tables/RLS, production Realtime subscriptions, translation
integration, notifications, media storage, and the wider conversation lifecycle.

## Agent Note
Web Speech is speech I/O, not the translation service. Do not expose translator secrets in frontend code.
