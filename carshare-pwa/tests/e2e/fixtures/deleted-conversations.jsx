import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessagingSessionProvider, useMessagingSession } from '../../../src/presentation/m3-messaging/context/MessagingSessionContext.jsx';
import ConversationList from '../../../src/presentation/m3-messaging/components/ConversationList.jsx';
import { MessagingService, createMessagingService } from '../../../src/business-logic/m3-messaging/MessagingService.js';
import { CallService } from '../../../src/business-logic/m3-messaging/CallService.js';
import '../../../src/presentation/shared/styles/theme.css';
import '../../../src/presentation/m3-messaging/styles/message.css';

let deletedBefore = null;
let newer = false;
let hold = false;
const pending = [];
function snapshot(value) {
  const copy = structuredClone(value);
  return hold ? new Promise((resolve) => pending.push(() => resolve(copy))) : Promise.resolve(copy);
}
const oldMessage = { id: 'old', sender_id: 'other', kind: 'user', text_content: 'Old secret', created_at: '2026-09-01T01:00:00Z', attachments: [] };
const newMessage = { ...oldMessage, id: 'new', text_content: 'Hello again', created_at: '2026-09-01T03:00:00Z' };
function row() {
  return {
    id: 'deleted-chat', type: 'direct', scope: 'friend', friendship: { status: 'accepted' },
    created_at: oldMessage.created_at,
    members: [
      { user_id: 'me', role: 'member', deleted_before: deletedBefore, profile: { full_name: 'Me' } },
      { user_id: 'other', role: 'member', profile: { full_name: 'Ahmad' } },
    ],
    last_message: newer ? newMessage : deletedBefore ? null : oldMessage,
  };
}
Object.assign(MessagingService, createMessagingService({
  getCurrentUserId: async () => 'me',
  listConversations: () => snapshot([row()]),
  getConversation: () => snapshot(row()),
  // Simulate the existing server-side history cutoff; no old data is returned.
  listMessages: () => snapshot(newer ? [newMessage] : deletedBefore ? [] : [oldMessage]),
  markConversationRead: async () => {},
}));
MessagingService.subscribeToMessaging = () => () => {};
CallService.listConversationCalls = async () => [];

function Harness() {
  const session = useMessagingSession();
  const [selected, setSelected] = useState(null);
  window.deletedChatTest = {
    startSlowRefresh: () => {
      hold = true;
      void session.refreshConversation('deleted-chat');
      void session.refreshConversations('active');
    },
    pending: () => pending.length,
    release: () => { hold = false; pending.splice(0).forEach((resolve) => resolve()); },
    newMessage: async () => {
      newer = true;
      await session.refreshConversations('active');
      await session.refreshConversation('deleted-chat');
    },
  };
  async function remove() {
    deletedBefore = newer ? '2026-09-01T04:00:00Z' : '2026-09-01T02:00:00Z';
    newer = false;
    hold = false;
    session.invalidateDeletedConversation('deleted-chat');
    setSelected(null);
    await session.refreshConversations('active');
  }
  return <main>
    <ConversationList conversations={session.folderState.items} currentUserId="me" folder="active"
      selectedConversationId={selected} onSelectConversation={async (id) => { setSelected(id); await session.refreshConversation(id); }}
      onManageConversation={() => {}} onFolderChange={() => {}} onBrowseRides={() => {}} onOpenFriends={() => {}} />
    <button onClick={remove}>Delete fixture conversation</button>
    <output aria-label="Unread count">{session.unreadMessageCount}</output>
    {selected && <section aria-label="Opened conversation">
      <h2>{session.getConversation(selected)?.title}</h2>
      {session.getMessagesState(selected).items.map((item) => <p key={item.id}>{item.text}</p>)}
    </section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<MessagingSessionProvider><Harness /></MessagingSessionProvider>);
