// ===== DATA ACCESS LAYER (Temporary Mock Data) =====
// This file contains dummy messaging data.
// It will later be replaced by Supabase repository functions.

export const CURRENT_USER_ID = 'me';

export const CURRENT_USER = {
  id: CURRENT_USER_ID,
  name: 'Amirah Yusof',
  avatar:
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&h=120&fit=crop&auto=format',
};

export const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  LOCATION: 'location',
  SYSTEM: 'system',
  HAZARD: 'hazard',
};

export const CONVERSATION_TYPE = {
  DIRECT: 'direct',
  GROUP: 'group',
};

export const conversations = [
  {
    id: 'conversation-1',
    type: CONVERSATION_TYPE.GROUP,
    title: 'KL to Penang Trip Group',
    tripBadge: 'Sat, 21 Dec',
    members: [
      {
        id: 'user-1',
        name: 'Ahmad Rizal',
        avatar:
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      },
      {
        id: 'user-2',
        name: 'Sarah Tan',
        avatar:
          'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
      },
      {
        id: 'user-3',
        name: 'Nurul Ain',
        avatar:
          'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
      },
      CURRENT_USER,
    ],
    lastMessage: 'Ahmad: Everyone be at KLCC by 6:45 AM',
    lastTime: '8:42 AM',
    unreadCount: 3,
    isArchived: false,
    tripRoute: 'KL Sentral to Georgetown, Penang',
    tripDate: 'Saturday, 21 December 2024',
    tripTime: '7:00 AM',
  },
  {
    id: 'conversation-2',
    type: CONVERSATION_TYPE.DIRECT,
    title: 'Ahmad Rizal',
    avatar:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
    members: [
      {
        id: 'user-1',
        name: 'Ahmad Rizal',
        avatar:
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      },
      CURRENT_USER,
    ],
    lastMessage: 'Confirmed. See you Saturday!',
    lastTime: 'Yesterday',
    unreadCount: 0,
    isArchived: false,
    tripRoute: 'KL Sentral to Georgetown, Penang',
    tripDate: 'Saturday, 21 December 2024',
    tripTime: '7:00 AM',
  },
  {
    id: 'conversation-3',
    type: CONVERSATION_TYPE.DIRECT,
    title: 'Sarah Tan',
    avatar:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
    members: [
      {
        id: 'user-2',
        name: 'Sarah Tan',
        avatar:
          'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
      },
      CURRENT_USER,
    ],
    lastMessage: 'Thanks for the ride. Had a great time!',
    lastTime: 'Monday',
    unreadCount: 0,
    isArchived: false,
  },
  {
    id: 'conversation-4',
    type: CONVERSATION_TYPE.GROUP,
    title: 'Subang to KL Morning Crew',
    tripBadge: 'Daily',
    members: [
      {
        id: 'user-4',
        name: 'Raj Kumar',
        avatar:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop&auto=format',
      },
      {
        id: 'user-2',
        name: 'Sarah Tan',
        avatar:
          'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
      },
      CURRENT_USER,
    ],
    lastMessage: 'Road hazard advisory near Subang toll',
    lastTime: '7:15 AM',
    unreadCount: 1,
    isArchived: false,
    tripRoute: 'Subang Jaya SS15 to Brickfields, KL',
    tripDate: 'Monday to Friday',
    tripTime: '7:00 AM',
  },
  {
    id: 'conversation-5',
    type: CONVERSATION_TYPE.DIRECT,
    title: 'Nurul Ain',
    avatar:
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
    members: [
      {
        id: 'user-3',
        name: 'Nurul Ain',
        avatar:
          'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
      },
      CURRENT_USER,
    ],
    lastMessage: 'See you at the pickup point!',
    lastTime: 'Sunday',
    unreadCount: 0,
    isArchived: true,
  },
];

export const conversationMessages = {
  'conversation-1': [
    {
      id: 'message-1',
      type: MESSAGE_TYPE.SYSTEM,
      senderId: 'system',
      senderName: '',
      senderAvatar: '',
      text: 'Group created for the KL to Penang trip',
      timestamp: '8:00 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-2',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      text: 'Selamat pagi semua! Ready for our trip to Penang this Saturday?',
      timestamp: '8:05 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-3',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-3',
      senderName: 'Nurul Ain',
      senderAvatar:
        'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
      text: 'Yes! I am excited for the trip. I cannot wait to try Penang food.',
      timestamp: '8:07 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-4',
      type: MESSAGE_TYPE.IMAGE,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      imageUrl:
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop&auto=format',
      text: 'Our planned breakfast stop at Ipoh Old Town.',
      timestamp: '8:10 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-5',
      type: MESSAGE_TYPE.HAZARD,
      senderId: 'system',
      senderName: '',
      senderAvatar: '',
      timestamp: '8:15 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
      hazard: {
        title: 'Traffic Incident',
        location: 'Rawang Toll, PLUS Highway',
        severity: 'Medium',
        reportedTime: '8:15 AM',
        detail:
          'A multi-vehicle accident has been reported. Expect a delay of approximately 20 to 30 minutes.',
      },
    },
    {
      id: 'message-6',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      text: 'We will use the alternate route through Batang Kali.',
      timestamp: '8:17 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-7',
      type: MESSAGE_TYPE.TEXT,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      text: 'Sounds good. I will bring some extra snacks for the journey.',
      timestamp: '8:20 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-8',
      type: MESSAGE_TYPE.LOCATION,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      timestamp: '8:35 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
      location: {
        name: 'KLCC Basement Carpark, Gate B',
        latitude: 3.1579,
        longitude: 101.7116,
      },
    },
    {
      id: 'message-9',
      type: MESSAGE_TYPE.VIDEO,
      senderId: 'user-3',
      senderName: 'Nurul Ain',
      senderAvatar:
        'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
      videoThumbnail:
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=400&fit=crop&auto=format',
      text: 'Penang Hill view from my previous trip.',
      timestamp: '8:40 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-10',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      text: 'Everyone please be at KLCC by 6:45 AM.',
      timestamp: '8:42 AM',
      isRead: false,
      isEdited: false,
      isDeleted: false,
    },
  ],

  'conversation-2': [
    {
      id: 'message-11',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-1',
      senderName: 'Ahmad Rizal',
      senderAvatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format',
      text: 'Hi Amirah, are you still joining the Penang trip?',
      timestamp: '10:20 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
    {
      id: 'message-12',
      type: MESSAGE_TYPE.TEXT,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      text: 'Yes, confirmed. See you on Saturday!',
      timestamp: '10:25 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
  ],

  'conversation-3': [
    {
      id: 'message-13',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-2',
      senderName: 'Sarah Tan',
      senderAvatar:
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&auto=format',
      text: 'Thanks for the ride. I had a great time!',
      timestamp: '6:40 PM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
  ],

  'conversation-4': [
    {
      id: 'message-14',
      type: MESSAGE_TYPE.HAZARD,
      senderId: 'system',
      senderName: '',
      senderAvatar: '',
      timestamp: '7:15 AM',
      isRead: false,
      isEdited: false,
      isDeleted: false,
      hazard: {
        title: 'Road Hazard Advisory',
        location: 'Subang Toll Plaza',
        severity: 'High',
        reportedTime: '7:15 AM',
        detail:
          'Heavy traffic has been reported near the toll plaza. Drivers should consider an alternative route.',
      },
    },
  ],

  'conversation-5': [
    {
      id: 'message-15',
      type: MESSAGE_TYPE.TEXT,
      senderId: 'user-3',
      senderName: 'Nurul Ain',
      senderAvatar:
        'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=120&h=120&fit=crop&auto=format',
      text: 'See you at the pickup point!',
      timestamp: '9:00 AM',
      isRead: true,
      isEdited: false,
      isDeleted: false,
    },
  ],
};

/**
 * Find one conversation by its ID.
 *
 * @param {string} conversationId
 * @returns {object|null}
 */
export function fetchConversationById(conversationId) {
  return (
    conversations.find(
      (conversation) => conversation.id === conversationId,
    ) ?? null
  );
}

/**
 * Get messages belonging to one conversation.
 *
 * @param {string} conversationId
 * @returns {Array}
 */
export function fetchMessagesByConversationId(conversationId) {
  return conversationMessages[conversationId] ?? [];
}