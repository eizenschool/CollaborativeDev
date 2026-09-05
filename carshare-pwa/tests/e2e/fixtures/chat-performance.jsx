import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ChatWindow from '../../../src/presentation/components/messaging/ChatWindow.jsx';
import { MessagingService } from '../../../src/business-logic/MessagingService.js';
import '../../../src/presentation/styles/theme.css';
import '../../../src/presentation/styles/message.css';

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
MessagingService.deleteForMe = async () => { window.chatMetrics.deletes += 1; };
MessagingService.deleteMessage = async () => { window.chatMetrics.deletes += 1; };
MessagingService.editMessage = async () => { window.chatMetrics.edits += 1; };
createRoot(document.getElementById('root')).render(
  <StrictMode><MemoryRouter><ChatWindow conversationId={conversation.id} currentUser={{ id: 'me' }} /></MemoryRouter></StrictMode>,
);
