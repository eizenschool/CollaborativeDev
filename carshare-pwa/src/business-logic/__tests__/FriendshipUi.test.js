import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

describe('friendship UI contract', () => {
  it('registers the static Friends route before the conversation-id route', () => {
    const app = read('src/App.jsx');
    expect(app.indexOf('path="/message/friends"')).toBeGreaterThan(-1);
    expect(app.indexOf('path="/message/friends"')).toBeLessThan(app.indexOf('path="/message/:conversationId"'));
  });

  it('provides incoming, friend and sent sections without global member search', () => {
    const center = read('src/presentation/components/messaging/FriendCenter.jsx');
    expect(center).toContain('Incoming requests');
    expect(center).toContain('Sent requests');
    expect(center).toContain('No public member search');
    expect(center).not.toContain('type="search"');
    expect(center).toContain('View profile');
    expect(center).toContain('Remove friend?');
  });

  it('exposes all public-profile relationship actions and preserves auth return', () => {
    const profile = read('src/presentation/components/PublicProfile.jsx');
    for (const label of ['Add friend', 'Request sent', 'Accept', 'Decline', 'Message']) {
      expect(profile).toContain(label);
    }
    expect(profile).toContain("from: `/users/${userId}`");
    expect(profile).toContain('sharePublicProfile');
  });

  it('labels friend chats separately and keeps removed chats visible as read-only', () => {
    const list = read('src/presentation/components/messaging/ConversationList.jsx');
    const chat = read('src/presentation/components/messaging/ChatWindow.jsx');
    const details = read('src/presentation/components/messaging/ConversationDetailsContent.jsx');
    expect(list).toContain('Not friends · Read-only');
    expect(chat).toContain("'Friend chat'");
    expect(chat).toContain('Add friend again');
    expect(details).toContain('Permanent friend chat');
  });

  it('opens group members from the chat header and routes member selection through public profiles', () => {
    const chat = read('src/presentation/components/messaging/ChatWindow.jsx');
    const details = read('src/presentation/components/messaging/ConversationDetailsContent.jsx');
    expect(chat).toContain('message-chat-group-trigger');
    expect(chat).toContain('message-chat-group-name');
    expect(chat).toContain('View members of');
    expect(details).toContain('Select a member to view their profile and friendship options.');
    expect(details).toContain('to={`/users/${member.id}`}');
    expect(details).toContain('View profile');
  });
});
