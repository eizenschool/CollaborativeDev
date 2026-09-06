import { describe, expect, it, vi } from 'vitest';
import {
  FRIENDSHIP_STATUS,
  createFriendshipService,
  groupFriendConnections,
  mapFriendship,
} from '../FriendshipService.js';

const otherUserId = '00000000-0000-4000-8000-000000000002';

function rawRelationship(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    status: 'accepted',
    otherUser: {
      id: otherUserId,
      displayName: 'Jamie D.',
      profilePhotoUrl: '/avatar.jpg',
    },
    conversationId: '20000000-0000-4000-8000-000000000001',
    requestedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    ...overrides,
  };
}

function repository() {
  return {
    backend: 'test',
    getRelationship: vi.fn(async () => rawRelationship()),
    listConnections: vi.fn(async () => [rawRelationship()]),
    sendRequest: vi.fn(async () => rawRelationship({ status: 'outgoing_pending', conversationId: null })),
    respondToRequest: vi.fn(async () => rawRelationship()),
    cancelRequest: vi.fn(async () => rawRelationship({ status: 'removed', conversationId: null })),
    removeFriend: vi.fn(async () => rawRelationship({ status: 'removed' })),
    openConversation: vi.fn(async () => rawRelationship().conversationId),
    subscribe: vi.fn(() => () => {}),
  };
}

describe('FriendshipService', () => {
  it('normalizes snake-case RPC payloads and unknown states', () => {
    expect(mapFriendship({
      status: 'incoming_pending',
      other_user: { id: otherUserId, display_name: 'Jamie D.', profile_photo_url: '/a.jpg' },
      conversation_id: null,
      requested_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-02T00:00:00Z',
    })).toMatchObject({
      status: FRIENDSHIP_STATUS.INCOMING_PENDING,
      otherUser: { id: otherUserId, displayName: 'Jamie D.', profilePhotoUrl: '/a.jpg' },
      conversationId: null,
    });
    expect(mapFriendship({ status: 'declined' }).status).toBe(FRIENDSHIP_STATUS.NONE);
  });

  it('groups incoming, accepted and sent rows without surfacing removed rows', () => {
    const grouped = groupFriendConnections([
      mapFriendship(rawRelationship({ status: 'incoming_pending' })),
      mapFriendship(rawRelationship({ id: 'friend-2' })),
      mapFriendship(rawRelationship({ id: 'friend-3', status: 'outgoing_pending' })),
      mapFriendship(rawRelationship({ id: 'friend-4', status: 'removed' })),
    ]);
    expect(grouped.incoming).toHaveLength(1);
    expect(grouped.friends).toHaveLength(1);
    expect(grouped.sent).toHaveLength(1);
  });

  it('routes every mutation through the narrow repository adapter', async () => {
    const adapter = repository();
    const service = createFriendshipService(adapter);

    await service.getRelationship(otherUserId);
    await service.listConnections();
    await service.sendRequest(otherUserId);
    await service.respondToRequest(otherUserId, true);
    await service.cancelRequest(otherUserId);
    await service.removeFriend(otherUserId);
    await expect(service.openConversation(otherUserId)).resolves.toMatch(/^2000/);

    expect(adapter.respondToRequest).toHaveBeenCalledWith(otherUserId, true);
    expect(adapter.removeFriend).toHaveBeenCalledWith(otherUserId);
    await expect(service.sendRequest('')).rejects.toThrow('Choose another member');
  });
});
