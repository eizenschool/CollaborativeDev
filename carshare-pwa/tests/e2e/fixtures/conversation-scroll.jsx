import React from 'react';
import { createRoot } from 'react-dom/client';
import ConversationList from '../../../src/presentation/m3-messaging/components/ConversationList.jsx';
import '../../../src/presentation/shared/styles/theme.css';
import '../../../src/presentation/m3-messaging/styles/message.css';
const count = Number(new URLSearchParams(location.search).get('count'));
const conversations = Array.from({ length: count }, (_, i) => ({
  id: String(i), title: `Conversation ${i + 1}`, type: 'group', scope: 'ride',
  members: [{ id: 'other', name: 'Member' }], lastMessage: 'Photo', lastTime: '12:25',
  rideStatus: 'Published', tripRoute: 'Setapak Central Mall to Kuala Lumpur', unreadCount: 0,
}));
createRoot(document.getElementById('root')).render(
  <div className="app-shell">
    <div className="mobile-appbar">Let's Tumpang</div>
    <header className="topnav">Navigation</header>
    <div className="app-main"><main className="message-module message-module-mobile">
      <ConversationList conversations={conversations} currentUserId="me" folder="active"
        onSelectConversation={() => {}} onManageConversation={() => {}}
        onFolderChange={() => {}} onOpenFriends={() => {}} />
    </main></div>
  </div>,
);
