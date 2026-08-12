// ===== DATA ACCESS LAYER (Local Messaging Store) =====
// This browser-only adapter is the demo backend for Module 3. It persists data
// for page refreshes and broadcasts changes to other same-origin browser tabs.

export const MESSAGING_STORAGE_KEY = 'letstumpang_messaging_v1';
export const MESSAGING_SCHEMA_VERSION = 1;

const CHANNEL_NAME = 'letstumpang_messaging_updates_v1';

const DEMO_USERS = {
  jamie: {
    id: 'u_demo_1',
    name: 'Jamie Delacroix',
    avatarUrl: null,
  },
  ahmad: {
    id: 'u_host_ahmad',
    name: 'Ahmad Rizal',
    avatarUrl:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
  },
  sarah: {
    id: 'u_host_sarah',
    name: 'Sarah Tan',
    avatarUrl:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
  },
};

function createSeedState() {
  const groupConversationId = 'conversation_demo_penang_group';
  const directConversationId = 'conversation_demo_penang_direct';

  return {
    version: MESSAGING_SCHEMA_VERSION,
    conversations: [
      {
        id: groupConversationId,
        type: 'group',
        rideId: 'r_1',
        title: 'KL Sentral to Georgetown Trip Group',
        trip: {
          route: 'KL Sentral, Brickfields to Georgetown, Penang',
          date: '2026-08-15',
          time: '07:00',
        },
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:08:00.000Z',
      },
      {
        id: directConversationId,
        type: 'direct',
        rideId: 'r_1',
        title: null,
        trip: {
          route: 'KL Sentral, Brickfields to Georgetown, Penang',
          date: '2026-08-15',
          time: '07:00',
        },
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:05:00.000Z',
      },
    ],
    memberships: [
      {
        conversationId: groupConversationId,
        user: DEMO_USERS.jamie,
        lastReadAt: '2026-08-10T00:08:00.000Z',
      },
      {
        conversationId: groupConversationId,
        user: DEMO_USERS.ahmad,
        lastReadAt: '2026-08-10T00:08:00.000Z',
      },
      {
        conversationId: groupConversationId,
        user: DEMO_USERS.sarah,
        lastReadAt: '2026-08-10T00:08:00.000Z',
      },
      {
        conversationId: directConversationId,
        user: DEMO_USERS.jamie,
        lastReadAt: '2026-08-09T00:05:00.000Z',
      },
      {
        conversationId: directConversationId,
        user: DEMO_USERS.ahmad,
        lastReadAt: '2026-08-09T00:05:00.000Z',
      },
    ],
    messages: [
      {
        id: 'message_demo_group_1',
        conversationId: groupConversationId,
        type: 'text',
        sender: DEMO_USERS.ahmad,
        text: 'Hi everyone. Please be at KL Sentral by 6:45 AM.',
        createdAt: '2026-08-10T00:05:00.000Z',
      },
      {
        id: 'message_demo_group_2',
        conversationId: groupConversationId,
        type: 'text',
        sender: DEMO_USERS.jamie,
        text: 'Confirmed. I will be there on time.',
        createdAt: '2026-08-10T00:08:00.000Z',
      },
      {
        id: 'message_demo_direct_1',
        conversationId: directConversationId,
        type: 'text',
        sender: DEMO_USERS.ahmad,
        text: 'Thanks for confirming the Penang ride.',
        createdAt: '2026-08-09T00:05:00.000Z',
      },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isValidState(value) {
  return (
    value &&
    value.version === MESSAGING_SCHEMA_VERSION &&
    Array.isArray(value.conversations) &&
    Array.isArray(value.memberships) &&
    Array.isArray(value.messages)
  );
}

function getBrowserStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserEventTarget() {
  return typeof window === 'undefined' ? null : window;
}

function createBrowserChannel() {
  if (typeof window === 'undefined' || !window.BroadcastChannel) {
    return null;
  }

  return new window.BroadcastChannel(CHANNEL_NAME);
}

/**
 * Creates a persistent local adapter that can be replaced by a Supabase adapter
 * later without changing the business-logic service or presentation components.
 */
export function createLocalMessagingStore({
  storage = getBrowserStorage(),
  eventTarget = getBrowserEventTarget(),
  channel = createBrowserChannel(),
} = {}) {
  const listeners = new Set();
  let memoryState = null;

  function readState() {
    if (storage) {
      try {
        const stored = storage.getItem(MESSAGING_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (isValidState(parsed)) {
            return parsed;
          }
        }
      } catch {
        // The in-memory copy below keeps the demo usable if browser storage fails.
      }
    }

    if (!memoryState) {
      memoryState = createSeedState();

      if (storage) {
        try {
          storage.setItem(
            MESSAGING_STORAGE_KEY,
            JSON.stringify(memoryState),
          );
        } catch {
          // The in-memory fallback is still sufficient for a single-tab demo.
        }
      }
    }

    return clone(memoryState);
  }

  function writeState(nextState) {
    const stateToSave = clone({
      ...nextState,
      version: MESSAGING_SCHEMA_VERSION,
    });

    memoryState = stateToSave;

    if (storage) {
      try {
        storage.setItem(
          MESSAGING_STORAGE_KEY,
          JSON.stringify(stateToSave),
        );
      } catch {
        // Continue with the in-memory fallback when storage is unavailable.
      }
    }
  }

  function notifyListeners() {
    listeners.forEach((listener) => listener());
  }

  function notifyOtherTabs() {
    if (channel) {
      channel.postMessage({ type: 'messaging-updated' });
    }
  }

  function handleExternalChange(event) {
    if (
      !event ||
      event.type === 'message' ||
      event.key === MESSAGING_STORAGE_KEY
    ) {
      memoryState = null;
      notifyListeners();
    }
  }

  if (channel) {
    channel.addEventListener('message', handleExternalChange);
  }

  if (eventTarget) {
    eventTarget.addEventListener('storage', handleExternalChange);
  }

  return {
    getState() {
      return clone(readState());
    },

    update(mutator) {
      const currentState = readState();
      const result = mutator(currentState);
      writeState(currentState);
      notifyListeners();
      notifyOtherTabs();
      return clone(result);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    resetForTests() {
      const seedState = createSeedState();
      writeState(seedState);
      notifyListeners();
    },

    destroy() {
      if (channel) {
        channel.removeEventListener('message', handleExternalChange);
        channel.close();
      }

      if (eventTarget) {
        eventTarget.removeEventListener('storage', handleExternalChange);
      }

      listeners.clear();
    },
  };
}

export const localMessagingStore = createLocalMessagingStore();
