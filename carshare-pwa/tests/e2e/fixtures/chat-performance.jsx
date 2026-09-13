import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ChatWindow from '../../../src/presentation/m3-messaging/components/ChatWindow.jsx';
import { MessagingService } from '../../../src/business-logic/m3-messaging/MessagingService.js';
import '../../../src/presentation/shared/styles/theme.css';
import '../../../src/presentation/m3-messaging/styles/message.css';

window.chatMetrics = { messageReads: 0, refreshes: 0, deletes: 0, edits: 0 };
const conversation = {
  id: 'performance-chat', title: 'Camera test', type: 'direct', scope: 'friend',
  isReadOnly: false, hasMessages: true, members: [{ id: 'me', name: 'Me' }, { id: 'other', name: 'Other' }],
};
const items = Array.from({ length: 200 }, (_, index) => ({
  id: `message-${index}`, kind: 'user', itemType: 'message', senderId: 'me', senderName: 'Me',
  get text() { window.chatMetrics.messageReads += 1; return `Message ${index}`; },
  attachments: [], messageTypes: ['text'], timestamp: '10:00', canEdit: true,
  canDelete: true, canDeleteForEveryone: true,
}));
const state = { items, loaded: true, loading: false, error: '' };
if (new URLSearchParams(window.location.search).has('tombstone')) {
  items[199] = { ...items[199], text: '', attachments: [], deletedAt: '2026-09-13T00:00:00Z', canEdit: false, canDeleteForEveryone: false };
}
window.chatTestSession = {
  getConversation: () => conversation,
  getMessagesState: () => state,
  getDraft: () => null, saveDraft: () => {}, clearDraft: () => {},
  refreshConversations: async () => [],
  refreshConversation: (_id, options) => {
    window.chatMetrics.refreshes += 1;
    // A slow history download must not lock the composer after a successful write.
    return options?.markRead ? Promise.resolve(conversation) : new Promise(() => {});
  },
};
window.chatMutation = { delayed: false, finish: null };
function mutation(result) {
  if (!window.chatMutation.delayed) return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    window.chatMutation.finish = (success) => success ? resolve(result) : reject(new Error('Request failed. Please retry.'));
  });
}
MessagingService.deleteForMe = async () => { window.chatMetrics.deletes += 1; return mutation(); };
MessagingService.deleteMessage = async () => { window.chatMetrics.deletes += 1; return mutation(); };
MessagingService.editMessage = async ({ messageId, text }) => {
  window.chatMetrics.edits += 1;
  return mutation({ ...items.find((item) => item.id === messageId), text, editedAt: '2026-09-13T01:00:00Z' });
};
const root = createRoot(document.getElementById('root'));
window.appendChatMessage = () => {
  state.items = [...state.items, { ...items[0], id: `incoming-${state.items.length}`, senderId: 'other', text: 'New incoming message' }];
  renderChat();
};
function renderChat() { root.render(
  <StrictMode><MemoryRouter><div style={{ height: '100dvh' }}><ChatWindow conversationId={conversation.id} currentUser={{ id: 'me' }} /></div></MemoryRouter></StrictMode>,
);
}
renderChat();
