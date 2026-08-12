// ===== BUSINESS LOGIC LAYER (MessagingService) =====
import { localMessagingStore } from '../data-access/localMessagingStore.js';

export const MESSAGE_TYPE = {
  TEXT: 'text',
};

export const CONVERSATION_TYPE = {
  DIRECT: 'direct',
  GROUP: 'group',
};

export const MAX_MESSAGE_LENGTH = 1000;

let lastTimestampMilliseconds = 0;

function createTimestamp() {
  const nextMilliseconds = Math.max(
    Date.now(),
    lastTimestampMilliseconds + 1,
  );
  lastTimestampMilliseconds = nextMilliseconds;
  return new Date(nextMilliseconds).toISOString();
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normaliseUser(user) {
  const id = user?.id;
  const name =
    user?.name ||
    user?.fullName ||
    user?.user_metadata?.full_name ||
    user?.email;

  if (!id || !name) {
    throw new Error('A valid messaging user is required.');
  }

  return {
    id,
    name,
    avatarUrl:
      user?.avatarUrl ||
      user?.avatar ||
      user?.profilePhotoUrl ||
      null,
  };
}

function getMembership(state, conversationId, userId) {
  return state.memberships.find(
    (membership) =>
      membership.conversationId === conversationId &&
      membership.user.id === userId,
  );
}

function getConversation(state, conversationId) {
  return state.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
}

function getConversationMessages(state, conversationId) {
  return state.messages
    .filter((message) => message.conversationId === conversationId)
    .sort(
      (firstMessage, secondMessage) =>
        new Date(firstMessage.createdAt) -
        new Date(secondMessage.createdAt),
    );
}

function formatMessageTime(isoTimestamp) {
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoTimestamp));
}

function formatConversationTime(isoTimestamp) {
  const timestamp = new Date(isoTimestamp);
  const now = new Date();
  const isToday = timestamp.toDateString() === now.toDateString();

  if (isToday) {
    return formatMessageTime(isoTimestamp);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (timestamp.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
  }).format(timestamp);
}

function getConversationMembers(state, conversationId) {
  return state.memberships
    .filter((membership) => membership.conversationId === conversationId)
    .map((membership) => membership.user);
}

function getDisplayTitle(conversation, members, currentUserId) {
  if (conversation.type === CONVERSATION_TYPE.GROUP) {
    return conversation.title || 'Ride group';
  }

  return (
    members.find((member) => member.id !== currentUserId)?.name ||
    'Private conversation'
  );
}

function getUnreadCount(state, conversationId, userId) {
  const membership = getMembership(state, conversationId, userId);
  if (!membership) {
    return 0;
  }

  return getConversationMessages(state, conversationId).filter(
    (message) =>
      message.sender.id !== userId &&
      (!membership.lastReadAt ||
        new Date(message.createdAt) >
          new Date(membership.lastReadAt)),
  ).length;
}

function toConversationView(state, conversation, currentUserId) {
  const members = getConversationMembers(state, conversation.id);
  const messages = getConversationMessages(state, conversation.id);
  const latestMessage = messages.at(-1) || null;

  return {
    ...conversation,
    title: getDisplayTitle(conversation, members, currentUserId),
    members,
    lastMessage: latestMessage?.text || 'No messages yet',
    lastMessageAt: latestMessage?.createdAt || conversation.updatedAt,
    lastTime: formatConversationTime(
      latestMessage?.createdAt || conversation.updatedAt,
    ),
    unreadCount: getUnreadCount(
      state,
      conversation.id,
      currentUserId,
    ),
    tripRoute: conversation.trip?.route || null,
    tripDate: conversation.trip?.date || null,
    tripTime: conversation.trip?.time || null,
    tripBadge: conversation.trip?.date || null,
  };
}

function toMessageView(message) {
  return {
    ...message,
    senderId: message.sender.id,
    senderName: message.sender.name,
    senderAvatar: message.sender.avatarUrl,
    timestamp: formatMessageTime(message.createdAt),
  };
}

function createConversationId(type, rideId, userIds) {
  const sortedUserIds = [...userIds].sort().join('__');
  return `${type}__${rideId}__${sortedUserIds}`;
}

function createTripSnapshot(ride) {
  const route =
    ride.route ||
    [ride.pickup, ride.destination].filter(Boolean).join(' to ') ||
    null;

  return {
    route,
    date: ride.date || null,
    time: ride.time || null,
  };
}

function createGroupTitle(ride, trip) {
  if (ride.title?.trim()) {
    return `${ride.title.trim()} Group`;
  }

  if (trip.route) {
    return `${trip.route} Trip Group`;
  }

  return 'Ride Trip Group';
}

function upsertMembership(state, conversationId, user) {
  const existingMembership = getMembership(
    state,
    conversationId,
    user.id,
  );

  if (existingMembership) {
    existingMembership.user = user;
    return;
  }

  state.memberships.push({
    conversationId,
    user,
    lastReadAt: null,
  });
}

function upsertConversation({
  state,
  id,
  type,
  rideId,
  title,
  trip,
  members,
  timestamp,
}) {
  let conversation = getConversation(state, id);

  if (!conversation) {
    conversation = {
      id,
      type,
      rideId,
      title,
      trip,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.conversations.push(conversation);
  } else {
    conversation.title = title;
    conversation.trip = trip;
  }

  members.forEach((member) => {
    upsertMembership(state, id, member);
  });

  return conversation;
}

/**
 * Creates the Module 3 business service against any compatible messaging store.
 * The default store is localStorage + same-origin tab synchronisation; a future
 * Supabase adapter can use this same public service contract.
 */
export function createMessagingService(store = localMessagingStore) {
  return {
    async listConversations({ user }) {
      const currentUser = normaliseUser(user);
      const state = store.getState();

      return state.conversations
        .filter((conversation) =>
          Boolean(
            getMembership(state, conversation.id, currentUser.id),
          ),
        )
        .map((conversation) =>
          toConversationView(state, conversation, currentUser.id),
        )
        .sort(
          (firstConversation, secondConversation) =>
            new Date(secondConversation.lastMessageAt) -
            new Date(firstConversation.lastMessageAt),
        );
    },

    async getConversation({ conversationId, user }) {
      const currentUser = normaliseUser(user);
      const state = store.getState();
      const conversation = getConversation(state, conversationId);

      if (
        !conversation ||
        !getMembership(state, conversationId, currentUser.id)
      ) {
        return null;
      }

      return toConversationView(state, conversation, currentUser.id);
    },

    async listMessages({ conversationId, user }) {
      const currentUser = normaliseUser(user);
      const state = store.getState();

      if (!getMembership(state, conversationId, currentUser.id)) {
        throw new Error('You do not have access to this conversation.');
      }

      return getConversationMessages(state, conversationId).map(
        toMessageView,
      );
    },

    async sendTextMessage({ conversationId, sender, text }) {
      const currentUser = normaliseUser(sender);
      const messageText = typeof text === 'string' ? text.trim() : '';

      if (!messageText) {
        throw new Error('Message cannot be empty.');
      }

      if (messageText.length > MAX_MESSAGE_LENGTH) {
        throw new Error(
          `Message must not exceed ${MAX_MESSAGE_LENGTH} characters.`,
        );
      }

      return store.update((state) => {
        const conversation = getConversation(state, conversationId);
        const membership = getMembership(
          state,
          conversationId,
          currentUser.id,
        );

        if (!conversation || !membership) {
          throw new Error('You do not have access to this conversation.');
        }

        const createdAt = createTimestamp();
        const message = {
          id: createId('message'),
          conversationId,
          type: MESSAGE_TYPE.TEXT,
          sender: currentUser,
          text: messageText,
          createdAt,
        };

        state.messages.push(message);
        conversation.updatedAt = createdAt;
        membership.lastReadAt = createdAt;

        return toMessageView(message);
      });
    },

    async markConversationRead({ conversationId, user }) {
      const currentUser = normaliseUser(user);
      const state = store.getState();
      const membership = getMembership(
        state,
        conversationId,
        currentUser.id,
      );

      if (!membership) {
        throw new Error('You do not have access to this conversation.');
      }

      const latestOtherMessage = getConversationMessages(
        state,
        conversationId,
      )
        .filter((message) => message.sender.id !== currentUser.id)
        .at(-1);

      if (
        !latestOtherMessage ||
        (membership.lastReadAt &&
          new Date(membership.lastReadAt) >=
            new Date(latestOtherMessage.createdAt))
      ) {
        return false;
      }

      store.update((nextState) => {
        const nextMembership = getMembership(
          nextState,
          conversationId,
          currentUser.id,
        );
        nextMembership.lastReadAt = latestOtherMessage.createdAt;
        return true;
      });

      return true;
    },

    /**
     * Module 2 integration contract: call this after a ride's accepted-passenger
     * list changes. It is idempotent and does not require Module 2 to know any
     * conversation IDs.
     */
    async syncAcceptedRideConversations({ ride, host, passengers }) {
      if (!ride?.id) {
        throw new Error('An accepted ride must include an ID.');
      }

      const hostUser = normaliseUser(host);
      const acceptedPassengers = [...new Map(
        (passengers || [])
          .map(normaliseUser)
          .filter((passenger) => passenger.id !== hostUser.id)
          .map((passenger) => [passenger.id, passenger]),
      ).values()];
      const trip = createTripSnapshot(ride);
      const timestamp = createTimestamp();

      const conversationIds = store.update((state) => {
        const directConversationIds = acceptedPassengers.map(
          (passenger) => {
            const directConversationId = createConversationId(
              CONVERSATION_TYPE.DIRECT,
              ride.id,
              [hostUser.id, passenger.id],
            );

            upsertConversation({
              state,
              id: directConversationId,
              type: CONVERSATION_TYPE.DIRECT,
              rideId: ride.id,
              title: null,
              trip,
              members: [hostUser, passenger],
              timestamp,
            });

            return directConversationId;
          },
        );

        let groupConversationId = null;
        if (acceptedPassengers.length >= 2) {
          groupConversationId = createConversationId(
            CONVERSATION_TYPE.GROUP,
            ride.id,
            [hostUser.id],
          );

          upsertConversation({
            state,
            id: groupConversationId,
            type: CONVERSATION_TYPE.GROUP,
            rideId: ride.id,
            title: createGroupTitle(ride, trip),
            trip,
            members: [hostUser, ...acceptedPassengers],
            timestamp,
          });
        }

        return {
          directConversationIds,
          groupConversationId,
        };
      });

      return conversationIds;
    },

    subscribe(listener) {
      return store.subscribe(listener);
    },
  };
}

export const MessagingService = createMessagingService();
