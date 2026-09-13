import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import MessageModule from '../../../src/presentation/m3-messaging/components/MessageModule.jsx';
import { MessagingSessionProvider, useMessagingSession } from '../../../src/presentation/m3-messaging/context/MessagingSessionContext.jsx';
import { MessagingService } from '../../../src/business-logic/m3-messaging/MessagingService.js';
import { FriendshipService } from '../../../src/business-logic/m3-messaging/FriendshipService.js';
import { CallService } from '../../../src/business-logic/m3-messaging/CallService.js';
import '../../../src/presentation/shared/styles/theme.css';

const conversation = { id: 'archive-chat', title: 'Ahmad', type: 'direct', scope: 'ride', rideStatus: 'Expired', members: [], lastMessage: 'Hello', unreadCount: 0, isArchived: false };
if (window.archiveTestScope === 'friend') conversation.scope = 'friend';
window.archiveFixture = { conversation, fail: false };
let holdRefresh = false;
const pending = [];
MessagingService.listConversations = async (folder) => {
  const rows = (folder === 'archived') === conversation.isArchived ? [{ ...conversation }] : [];
  return holdRefresh ? new Promise(resolve => pending.push(() => resolve(rows))) : rows;
};
MessagingService.getConversation = async () => ({ ...conversation });
MessagingService.listMessages = async () => [];
CallService.listConversationCalls = async () => [];
MessagingService.markConversationRead = async () => {};
MessagingService.subscribeToMessaging = () => () => {};
MessagingService.archiveConversation = async () => {
  if (window.archiveFixture.fail) throw new Error('Unable to archive conversation.');
  conversation.isArchived = true;
};
FriendshipService.listConnections = async () => [];
FriendshipService.subscribe = () => () => {};

function RefreshControls() {
  const session = useMessagingSession();
  window.archiveFixture.holdRefresh = () => {
    holdRefresh = true;
    window.archiveFixture.staleRequest = session.refreshConversations('active');
  };
  window.archiveFixture.releaseStale = async () => {
    pending.shift()?.();
    await window.archiveFixture.staleRequest;
  };
  window.archiveFixture.releaseAll = () => {
    holdRefresh = false;
    pending.splice(0).forEach(resolve => resolve());
  };
  return null;
}

function RouteShell() {
  const location = useLocation();
  // Match AppShell: changing pathname remounts the entire route subtree.
  return <div key={location.pathname}><Routes>
    <Route path="/message" element={<MessageModule />} />
    <Route path="/message/:conversationId" element={<MessageModule />} />
  </Routes></div>;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter><MessagingSessionProvider><RefreshControls /><RouteShell /></MessagingSessionProvider></BrowserRouter>,
);
