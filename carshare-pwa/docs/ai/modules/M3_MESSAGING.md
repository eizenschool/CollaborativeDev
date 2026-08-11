# Module 3 — Messaging

## Owner
Chong Zheng Zhe

## Purpose
Trip-bound communication between hosts and accepted travellers.

## Requirement Intent
Text/image/video, location sharing, conversation list/history, sender/timestamp/type, notifications, hazard advisories, translation, edit-before-read, realtime, delete, archive/leave.

## Existing Repository Areas
Presentation: `src/presentation/components/messaging/` including `MessageModule.jsx`, `ConversationList.jsx`, `ChatWindow.jsx`, `MessageBubble.jsx`, `TripInfoSidebar.jsx`.
Data prototype: `src/data-access/mockMessageData.js`.
Styles: `src/presentation/styles/message.css`.

## Depends On
Module 2 accepted ride/participation; Module 6 hazard advisories; translation provider; Supabase Realtime/Storage if selected.

## Current Status
Messaging UI/prototype code already exists in `Development`.

## Open Questions
Conversation model; private/group semantics; tables/RLS; realtime subscriptions; translation integration; notifications; media storage.

## Agent Note
Web Speech is speech I/O, not the translation service. Do not expose translator secrets in frontend code.
