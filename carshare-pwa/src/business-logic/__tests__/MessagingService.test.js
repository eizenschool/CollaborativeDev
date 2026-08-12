import { describe, expect, it } from 'vitest';
import {
  createMessagingService,
  MAX_MESSAGE_LENGTH,
} from '../MessagingService.js';
import { createLocalMessagingStore } from '../../data-access/localMessagingStore.js';

const host = {
  id: 'host_1',
  fullName: 'Ahmad Rizal',
};

const firstPassenger = {
  id: 'passenger_1',
  fullName: 'Aina Farhana',
};

const secondPassenger = {
  id: 'passenger_2',
  fullName: 'Daniel Lim',
};

const thirdPassenger = {
  id: 'passenger_3',
  fullName: 'Priya Nair',
};

const ride = {
  id: 'ride_messaging_test',
  pickup: 'KL Sentral',
  destination: 'Georgetown, Penang',
  date: '2026-08-15',
  time: '07:00',
};

function createTestService() {
  let storedValue = JSON.stringify({
    version: 1,
    conversations: [],
    memberships: [],
    messages: [],
  });
  const store = createLocalMessagingStore({
    storage: {
      getItem: () => storedValue,
      setItem: (_, value) => {
        storedValue = value;
      },
    },
    eventTarget: null,
    channel: null,
  });

  return {
    store,
    service: createMessagingService(store),
  };
}

describe('MessagingService', () => {
  it('creates one private chat for the first passenger and no group chat', async () => {
    const { service } = createTestService();

    const result = await service.syncAcceptedRideConversations({
      ride,
      host,
      passengers: [firstPassenger],
    });

    expect(result.directConversationIds).toHaveLength(1);
    expect(result.groupConversationId).toBeNull();

    const hostConversations = await service.listConversations({ user: host });
    const matchingConversations = hostConversations.filter(
      (conversation) => conversation.rideId === ride.id,
    );

    expect(matchingConversations).toHaveLength(1);
    expect(matchingConversations[0].type).toBe('direct');
  });

  it('creates a group at the second passenger and adds later passengers without duplicates', async () => {
    const { service, store } = createTestService();

    await service.syncAcceptedRideConversations({
      ride,
      host,
      passengers: [firstPassenger],
    });
    const secondSync = await service.syncAcceptedRideConversations({
      ride,
      host,
      passengers: [firstPassenger, secondPassenger],
    });
    await service.syncAcceptedRideConversations({
      ride,
      host,
      passengers: [firstPassenger, secondPassenger, thirdPassenger],
    });
    await service.syncAcceptedRideConversations({
      ride,
      host,
      passengers: [firstPassenger, secondPassenger, thirdPassenger],
    });

    const state = store.getState();
    const rideConversations = state.conversations.filter(
      (conversation) => conversation.rideId === ride.id,
    );
    const groupConversation = rideConversations.find(
      (conversation) => conversation.type === 'group',
    );
    const groupMemberships = state.memberships.filter(
      (membership) => membership.conversationId === groupConversation.id,
    );

    expect(secondSync.groupConversationId).toBe(groupConversation.id);
    expect(rideConversations.filter((item) => item.type === 'direct')).toHaveLength(3);
    expect(groupMemberships.map((membership) => membership.user.id).sort()).toEqual(
      [host.id, firstPassenger.id, secondPassenger.id, thirdPassenger.id].sort(),
    );
  });

  it('validates text messages and only permits conversation members to send', async () => {
    const { service } = createTestService();
    const { directConversationIds } =
      await service.syncAcceptedRideConversations({
        ride,
        host,
        passengers: [firstPassenger],
      });
    const conversationId = directConversationIds[0];

    await expect(
      service.sendTextMessage({
        conversationId,
        sender: host,
        text: '   ',
      }),
    ).rejects.toThrow('Message cannot be empty.');

    await expect(
      service.sendTextMessage({
        conversationId,
        sender: host,
        text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
      }),
    ).rejects.toThrow(`Message must not exceed ${MAX_MESSAGE_LENGTH} characters.`);

    await expect(
      service.sendTextMessage({
        conversationId,
        sender: secondPassenger,
        text: 'Can I join?',
      }),
    ).rejects.toThrow('You do not have access to this conversation.');
  });

  it('persists a sent message, updates order, and exposes it as unread to the recipient', async () => {
    const { service } = createTestService();
    const { directConversationIds } =
      await service.syncAcceptedRideConversations({
        ride,
        host,
        passengers: [firstPassenger],
      });
    const conversationId = directConversationIds[0];

    const message = await service.sendTextMessage({
      conversationId,
      sender: firstPassenger,
      text: 'I will be at the pickup point early.',
    });
    const messages = await service.listMessages({
      conversationId,
      user: host,
    });
    const hostConversations = await service.listConversations({ user: host });

    expect(messages.at(-1).id).toBe(message.id);
    expect(messages.at(-1).text).toBe('I will be at the pickup point early.');
    expect(hostConversations[0].id).toBe(conversationId);
    expect(hostConversations[0].unreadCount).toBe(1);

    await service.markConversationRead({ conversationId, user: host });
    const conversationsAfterRead = await service.listConversations({ user: host });

    expect(
      conversationsAfterRead.find(
        (conversation) => conversation.id === conversationId,
      ).unreadCount,
    ).toBe(0);
  });

  it('writes through storage so a fresh store instance can read message history', async () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
    const initialState = {
      version: 1,
      conversations: [],
      memberships: [],
      messages: [],
    };
    values.set('letstumpang_messaging_v1', JSON.stringify(initialState));
    const firstStore = createLocalMessagingStore({
      storage,
      eventTarget: null,
      channel: null,
    });
    const firstService = createMessagingService(firstStore);
    const { directConversationIds } =
      await firstService.syncAcceptedRideConversations({
        ride,
        host,
        passengers: [firstPassenger],
      });

    await firstService.sendTextMessage({
      conversationId: directConversationIds[0],
      sender: host,
      text: 'Persist this message.',
    });

    const secondStore = createLocalMessagingStore({
      storage,
      eventTarget: null,
      channel: null,
    });
    const secondService = createMessagingService(secondStore);
    const messages = await secondService.listMessages({
      conversationId: directConversationIds[0],
      user: firstPassenger,
    });

    expect(messages.at(-1).text).toBe('Persist this message.');
  });
});
