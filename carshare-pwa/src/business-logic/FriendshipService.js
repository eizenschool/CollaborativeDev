import { supabaseFriendshipRepository } from '../data-access/supabaseFriendshipRepository.js';

export const FRIENDSHIP_STATUS = Object.freeze({
  NONE: 'none',
  OUTGOING_PENDING: 'outgoing_pending',
  INCOMING_PENDING: 'incoming_pending',
  ACCEPTED: 'accepted',
  REMOVED: 'removed',
});

const VALID_STATUSES = new Set(Object.values(FRIENDSHIP_STATUS));

function requireOtherUserId(otherUserId) {
  if (!otherUserId) throw new Error('Choose another member.');
  return otherUserId;
}

export function mapFriendship(value, fallbackOtherUserId = null) {
  const status = VALID_STATUSES.has(value?.status) ? value.status : FRIENDSHIP_STATUS.NONE;
  const otherUser = value?.otherUser || value?.other_user || null;
  return {
    id: value?.id || null,
    status,
    otherUser: {
      id: otherUser?.id || fallbackOtherUserId,
      displayName: otherUser?.displayName ?? otherUser?.display_name ?? 'Member',
      profilePhotoUrl: otherUser?.profilePhotoUrl ?? otherUser?.profile_photo_url ?? null,
    },
    conversationId: value?.conversationId ?? value?.conversation_id ?? null,
    requestedAt: value?.requestedAt ?? value?.requested_at ?? null,
    updatedAt: value?.updatedAt ?? value?.updated_at ?? null,
  };
}

export function groupFriendConnections(connections = []) {
  return connections.reduce((groups, connection) => {
    if (connection.status === FRIENDSHIP_STATUS.INCOMING_PENDING) groups.incoming.push(connection);
    else if (connection.status === FRIENDSHIP_STATUS.OUTGOING_PENDING) groups.sent.push(connection);
    else if (connection.status === FRIENDSHIP_STATUS.ACCEPTED) groups.friends.push(connection);
    return groups;
  }, { incoming: [], friends: [], sent: [] });
}

export function createFriendshipService(repository = supabaseFriendshipRepository) {
  const mapResult = (value, otherUserId) => mapFriendship(value, otherUserId);
  return {
    backend: repository.backend,

    async getRelationship(otherUserId) {
      const id = requireOtherUserId(otherUserId);
      return mapResult(await repository.getRelationship(id), id);
    },

    async listConnections() {
      const rows = await repository.listConnections();
      return (rows || []).map((row) => mapResult(row));
    },

    async sendRequest(otherUserId) {
      const id = requireOtherUserId(otherUserId);
      return mapResult(await repository.sendRequest(id), id);
    },

    async respondToRequest(otherUserId, accept) {
      const id = requireOtherUserId(otherUserId);
      if (typeof accept !== 'boolean') throw new Error('Choose whether to accept or decline this request.');
      return mapResult(await repository.respondToRequest(id, accept), id);
    },

    async cancelRequest(otherUserId) {
      const id = requireOtherUserId(otherUserId);
      return mapResult(await repository.cancelRequest(id), id);
    },

    async removeFriend(otherUserId) {
      const id = requireOtherUserId(otherUserId);
      return mapResult(await repository.removeFriend(id), id);
    },

    async openConversation(otherUserId) {
      return repository.openConversation(requireOtherUserId(otherUserId));
    },

    subscribe(listener) {
      return repository.subscribe(listener);
    },
  };
}

export const FriendshipService = createFriendshipService();
