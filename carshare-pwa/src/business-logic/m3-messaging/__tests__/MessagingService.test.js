import { describe, expect, it, vi } from 'vitest';
import {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_COUNT,
  MAX_MESSAGE_MEDIA_BYTES,
  MAX_VIDEO_BYTES,
  countUnreadMessages,
  createMessagingService,
  getMessagingChangeConversationId,
  isTerminalRideStatus,
  mapConversationRow,
  mapMessageRow,
  validateMessageDraft,
} from '../MessagingService.js';

const userId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const conversationId = '10000000-0000-4000-8000-000000000001';

function file(name, type, size) {
  return { name, type, size };
}

function image(name = 'photo.jpg', size = 1024) {
  return file(name, 'image/jpeg', size);
}

function video(name = 'clip.mp4', size = 2048) {
  return file(name, 'video/mp4', size);
}

function audio(name = 'voice.webm', size = 1024) {
  return file(name, 'audio/webm', size);
}

function voiceRecording(overrides = {}) {
  return {
    file: audio(),
    durationSeconds: 12,
    ...overrides,
  };
}

describe('message unread totals', () => {
  it('sums positive unread counts and ignores invalid values', () => {
    expect(countUnreadMessages([
      { id: 'one', unreadCount: 2 },
      { id: 'two', unreadCount: 0 },
      { id: 'three', unreadCount: 5 },
      { id: 'negative', unreadCount: -2 },
      { id: 'invalid', unreadCount: 'not-a-number' },
      null,
    ])).toBe(7);
  });
});

describe('terminal conversation rules', () => {
  it.each(['Completed', 'Cancelled', 'Expired'])('treats %s as terminal', (status) => {
    expect(isTerminalRideStatus(status)).toBe(true);
  });

  it.each(['Published', 'In Progress', null])('does not treat %s as terminal', (status) => {
    expect(isTerminalRideStatus(status)).toBe(false);
  });
});

describe('legacy conversation compatibility', () => {
  it('keeps the ride context from pre-075 direct conversations', () => {
    const conversation = mapConversationRow(rawConversation({
      ride_contexts: undefined,
      ride: {
        id: '20000000-0000-4000-8000-000000000001',
        pickup: 'KL Sentral',
        destination: 'Penang',
        departure_at: '2026-08-15T00:00:00Z',
      },
    }), userId);

    expect(conversation).toMatchObject({
      rideId: '20000000-0000-4000-8000-000000000001',
      pickup: 'KL Sentral',
      destination: 'Penang',
      tripRoute: 'KL Sentral to Penang',
    });
  });

  it('maps accepted friend chats without ride lifecycle fields', () => {
    const conversation = mapConversationRow(rawConversation({
      scope: 'friend',
      ride_id: null,
      ride_status: null,
      trip_route: null,
      trip_departure_at: null,
      expires_at: null,
      friendship: { status: 'accepted' },
      members: [
        { user_id: userId, role: 'friend', profile: { full_name: 'Aina', status: 'active' } },
        { user_id: otherId, role: 'friend', profile: { full_name: 'Ahmad', status: 'active' } },
      ],
    }), userId);

    expect(conversation).toMatchObject({
      scope: 'friend',
      friendshipStatus: 'accepted',
      otherUserId: otherId,
      rideId: null,
      rideStatus: null,
      tripRoute: null,
      expiresAt: null,
      effectiveExpiresAt: null,
      isReadOnly: false,
    });
  });

  it('makes removed friendships and unavailable friend accounts read-only', () => {
    const friendRow = {
      scope: 'friend',
      ride_id: null,
      ride_status: null,
      trip_route: null,
      friendship: { status: 'removed' },
      members: [
        { user_id: userId, role: 'friend', profile: { full_name: 'Aina', status: 'active' } },
        { user_id: otherId, role: 'friend', profile: { full_name: 'Ahmad', status: 'active' } },
      ],
    };
    expect(mapConversationRow(rawConversation(friendRow), userId).isReadOnly).toBe(true);
    expect(mapConversationRow(rawConversation({
      ...friendRow,
      friendship: { status: 'accepted' },
      members: [
        { user_id: userId, role: 'friend', profile: { full_name: 'Aina', status: 'active' } },
        { user_id: otherId, role: 'friend', profile: { full_name: 'Ahmad', status: 'deactivated' } },
      ],
    }), userId)).toMatchObject({ isReadOnly: true, friendAccountsAvailable: false });
  });
});

function rawConversation(overrides = {}) {
  return {
    id: conversationId,
    ride_id: '20000000-0000-4000-8000-000000000001',
    type: 'direct',
    ride_status: 'Published',
    trip_route: 'KL Sentral to Penang',
    trip_departure_at: '2026-08-15T00:00:00Z',
    created_at: '2026-08-10T00:00:00Z',
    members: [
      { user_id: userId, role: 'traveller', profile: { full_name: 'Aina' } },
      { user_id: otherId, role: 'host', profile: { full_name: 'Ahmad' } },
    ],
    ...overrides,
  };
}

function rawMessage(overrides = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    conversation_id: conversationId,
    sender_id: userId,
    kind: 'user',
    text_content: 'Hello',
    created_at: '2026-08-10T01:00:00Z',
    edited_at: null,
    deleted_at: null,
    sender: { full_name: 'Aina', profile_photo_url: null },
    attachments: [],
    ...overrides,
  };
}

function createRepository({ messages = [], conversations = [rawConversation()], failUploadName = null, failEdit = false } = {}) {
  let storedMessages = structuredClone(messages);
  const removedPaths = [];
  const uploads = [];
  let sequence = 0;
  const repository = {
    backend: 'test',
    removedPaths,
    uploads,
    getStoredMessages: () => structuredClone(storedMessages),
    getCurrentUserId: async () => userId,
    openRideDirectConversation: async () => conversationId,
    listConversations: async () => structuredClone(conversations),
    getConversation: async () => rawConversation(),
    listMessages: async () => structuredClone(storedMessages),
    getMessage: async (id) => structuredClone(storedMessages.find((message) => message.id === id) || null),
    listRideInviteOptions: async () => [{
      ride_id: '20000000-0000-4000-8000-000000000099',
      pickup: 'KL Sentral',
      destination: 'Penang',
      departure_at: '2026-08-15T00:00:00Z',
      seats_available: 2,
      contribution: '35.00',
      ride_status: 'Published',
      source_role: 'passenger',
    }],
    sendRideInvitation: async ({ messageId, rideId, text }) => {
      storedMessages.push(rawMessage({
        id: messageId,
        text_content: text || null,
        ride_invitation: {
          ride_id: rideId,
          pickup: 'KL Sentral',
          destination: 'Penang',
          departure_at: '2026-08-15T00:00:00Z',
          seats_available: 2,
          contribution: '35.00',
          ride_status: 'Published',
          request_status: null,
          can_request: true,
        },
      }));
      return messageId;
    },
    uploadMedia: async ({ messageId, versionId, file: mediaFile }) => {
      if (mediaFile.name === failUploadName) throw new Error('upload failed');
      const path = `${userId}/${conversationId}/${messageId}/${versionId}/${mediaFile.name}`;
      uploads.push(path);
      return path;
    },
    removeMedia: async (paths) => { removedPaths.push(...paths); return true; },
    translateMessage: async ({ targetLanguage }) => ({
      sourceLanguage: 'ms',
      transcript: null,
      translatedText: targetLanguage === 'zh' ? '我们在这里见面。' : 'Meet here.',
      targetLanguage,
      cached: true,
    }),
    sendMessage: async ({ messageId, text, attachments }) => {
      sequence += 1;
      const id = messageId;
      storedMessages.push(rawMessage({
        id,
        text_content: text || null,
        created_at: `2026-08-10T01:00:0${sequence}Z`,
        attachments: attachments.map((attachment, index) => ({ id: `a-${sequence}-${index}`, ...attachment })),
      }));
      return id;
    },
    editMessage: async ({ messageId, text, attachments }) => {
      if (failEdit) throw new Error('read race');
      const next = storedMessages.map((message) => message.id === messageId ? {
        ...message,
        text_content: text || null,
        edited_at: '2026-08-10T02:00:00Z',
        attachments: attachments.map((attachment, index) => ({ id: `edited-${index}`, ...attachment })),
      } : message);
      storedMessages = next;
      return messageId;
    },
    deleteMessage: async (messageId) => {
      const target = storedMessages.find((message) => message.id === messageId);
      const paths = target.attachments.map((attachment) => attachment.storage_path).filter(Boolean);
      storedMessages = storedMessages.map((message) => message.id === messageId
        ? { ...message, text_content: null, attachments: [], deleted_at: '2026-08-10T03:00:00Z' }
        : message);
      return paths;
    },
    markConversationRead: async () => true,
    archiveConversation: async () => true,
    unarchiveConversation: async () => true,
    deleteConversationForMe: async () => true,
    blockUser: async () => true,
    unblockUser: async () => true,
    leaveGroup: async () => true,
    subscribe: () => () => {},
  };
  return repository;
}

describe('composite message validation', () => {
  it.each([
    [{ text: 'text' }, ['text']],
    [{ files: [image()] }, ['image']],
    [{ files: [video()] }, ['video']],
    [{ location: { latitude: 3.139, longitude: 101.6869 } }, ['location']],
    [{ voiceRecording: voiceRecording() }, ['audio']],
    [{ text: 'all', files: [image(), video()], location: { latitude: 3, longitude: 101 } }, ['text', 'image', 'video', 'location']],
  ])('accepts supported combinations %#', (draft) => {
    expect(validateMessageDraft(draft)).toMatchObject({ text: draft.text?.trim() || '' });
  });

  it('accepts 10 mixed media and rejects 11', () => {
    const ten = Array.from({ length: MAX_MEDIA_COUNT }, (_, index) => index % 2 ? video(`v${index}.mp4`) : image(`i${index}.jpg`));
    expect(validateMessageDraft({ files: ten }).files).toHaveLength(10);
    expect(() => validateMessageDraft({ files: [...ten, image('extra.jpg')] })).toThrow('at most 10');
  });

  it('enforces type, per-file, total-size, coordinate and empty-message rules', () => {
    expect(() => validateMessageDraft({ files: [image('large.jpg', MAX_IMAGE_BYTES + 1)] })).toThrow('10 MB');
    expect(() => validateMessageDraft({ files: [video('large.mp4', MAX_VIDEO_BYTES + 1)] })).toThrow('50 MB');
    expect(() => validateMessageDraft({ files: [file('bad.gif', 'image/gif', 10)] })).toThrow('not a supported');
    expect(() => validateMessageDraft({ files: [video('one.mp4', MAX_VIDEO_BYTES), video('two.mp4', MAX_VIDEO_BYTES), image('extra.jpg', 1)] })).toThrow('100 MB');
    expect(MAX_MESSAGE_MEDIA_BYTES).toBe(100 * 1024 * 1024);
    expect(() => validateMessageDraft({ location: { latitude: 91, longitude: 0 } })).toThrow('coordinates');
    expect(() => validateMessageDraft({ text: '  ' })).toThrow('Add text, media, a location, or a voice message');
  });

  it('accepts one standalone voice message and enforces its format, size and duration', () => {
    const valid = validateMessageDraft({ voiceRecording: voiceRecording() });
    expect(valid.voiceRecording).toMatchObject({ durationSeconds: 12 });
    expect(() => validateMessageDraft({
      text: 'caption',
      voiceRecording: voiceRecording(),
    })).toThrow('sent on their own');
    expect(() => validateMessageDraft({
      files: [audio()],
    })).toThrow('supported photo or video');
    expect(() => validateMessageDraft({
      voiceRecording: voiceRecording({ file: audio('large.webm', MAX_VOICE_BYTES + 1) }),
    })).toThrow('10 MB');
    expect(() => validateMessageDraft({
      voiceRecording: voiceRecording({ durationSeconds: MAX_VOICE_DURATION_SECONDS + 1 }),
    })).toThrow('between 1 and 180 seconds');
    expect(() => validateMessageDraft({
      voiceRecording: voiceRecording({ file: file('voice.aac', 'audio/aac', 1024) }),
    })).toThrow('supported voice-message format');
  });

  it.each([
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ])('accepts supported recorder MIME %s', (mimeType) => {
    const valid = validateMessageDraft({
      voiceRecording: voiceRecording({ file: file('voice', mimeType, 1024) }),
    });
    expect(valid.voiceRecording.file.type).toBe(mimeType);
  });
});

describe('MessagingService repository orchestration', () => {
  it('hides empty ride direct drafts while retaining chats with messages or calls', async () => {
    const conversations = [
      rawConversation({ id: '10000000-0000-4000-8000-000000000010' }),
      rawConversation({ id: '10000000-0000-4000-8000-000000000011', type: 'group' }),
      rawConversation({
        id: '10000000-0000-4000-8000-000000000012',
        scope: 'friend',
        ride_id: null,
        ride_status: null,
        trip_route: null,
        friendship: { status: 'accepted' },
      }),
      rawConversation({
        id: '10000000-0000-4000-8000-000000000013',
        last_message: rawMessage({ conversation_id: '10000000-0000-4000-8000-000000000013' }),
      }),
      rawConversation({
        id: '10000000-0000-4000-8000-000000000014',
        latest_call: {
          id: '40000000-0000-4000-8000-000000000001',
          conversation_id: '10000000-0000-4000-8000-000000000014',
          caller_id: userId,
          status: 'cancelled',
          created_at: '2026-08-10T02:00:00Z',
        },
      }),
    ];
    const service = createMessagingService(createRepository({ conversations }));
    const visible = await service.listConversations();

    expect(visible).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '10000000-0000-4000-8000-000000000011', type: 'group', hasMessages: false }),
      expect.objectContaining({ id: '10000000-0000-4000-8000-000000000012', scope: 'friend', hasMessages: false }),
      expect.objectContaining({ id: '10000000-0000-4000-8000-000000000013', type: 'direct', hasMessages: true }),
      expect.objectContaining({
        id: '10000000-0000-4000-8000-000000000014',
        type: 'direct',
        hasMessages: false,
        hasCalls: true,
        lastMessage: 'Cancelled call',
      }),
    ]));
    expect(visible).toHaveLength(4);
    expect(visible.map((conversation) => conversation.id)).not.toContain('10000000-0000-4000-8000-000000000010');
  });

  it('reveals a personally deleted conversation when a newer call is created', () => {
    const conversation = mapConversationRow(rawConversation({
      members: [
        {
          user_id: userId,
          role: 'traveller',
          deleted_before: '2026-08-10T01:00:00Z',
          profile: { full_name: 'Aina' },
        },
        { user_id: otherId, role: 'host', profile: { full_name: 'Ahmad' } },
      ],
      latest_call: {
        id: '40000000-0000-4000-8000-000000000002',
        conversation_id: conversationId,
        caller_id: otherId,
        status: 'missed',
        created_at: '2026-08-10T02:00:00Z',
      },
    }), userId);

    expect(conversation).toMatchObject({
      isHiddenByDelete: false,
      hasActivity: true,
      lastMessage: 'Missed call',
      lastMessageAt: '2026-08-10T02:00:00Z',
    });
  });

  it('keeps archived conversations writable and maps personal deletion state', async () => {
    const archived = mapConversationRow(rawConversation({
      members: [
        { user_id: userId, role: 'member', archived_at: '2026-08-10T02:00:00Z', deleted_before: null, profile: { full_name: 'Aina' } },
        { user_id: otherId, role: 'member', profile: { full_name: 'Ahmad' } },
      ],
    }), userId);
    expect(archived).toMatchObject({ isArchived: true, isReadOnly: false, isHiddenByDelete: false });
  });

  it('maps terminal mute state and retained former group access', () => {
    const conversation = mapConversationRow(rawConversation({
      type: 'group',
      ride_status: 'Cancelled',
      expires_at: '2026-08-17T02:00:00Z',
      members: [
        {
          user_id: userId,
          role: 'traveller',
          left_at: '2026-08-10T02:00:00Z',
          access_expires_at: '2026-08-17T02:00:00Z',
          muted_at: '2026-08-10T03:00:00Z',
          profile: { full_name: 'Aina' },
        },
        { user_id: otherId, role: 'host', profile: { full_name: 'Ahmad' } },
      ],
    }), userId);

    expect(conversation).toMatchObject({
      isMuted: true,
      isFormerMember: true,
      isReadOnly: true,
      isTerminal: true,
      effectiveExpiresAt: '2026-08-17T02:00:00.000Z',
    });
    expect(conversation.members.map((member) => member.id)).toEqual([otherId]);
  });

  it('validates supported translation languages and maps cached results', async () => {
    const service = createMessagingService(createRepository());
    await expect(service.translateMessage(rawMessage().id, 'zh')).resolves.toEqual({
      sourceLanguage: 'ms',
      transcript: null,
      translatedText: '我们在这里见面。',
      targetLanguage: 'zh',
      cached: true,
    });
    await expect(service.translateMessage(rawMessage().id, 'fr')).rejects.toThrow(
      'Choose English, Chinese, Bahasa Melayu, or Tamil',
    );
  });

  it('maps Realtime payloads to their owning conversation', () => {
    expect(getMessagingChangeConversationId({
      table: 'conversations',
      new: { id: conversationId },
    })).toBe(conversationId);
    expect(getMessagingChangeConversationId({
      table: 'messages',
      new: { conversation_id: conversationId },
    })).toBe(conversationId);
    expect(getMessagingChangeConversationId({
      table: 'conversation_members',
      new: {},
      old: { conversation_id: conversationId },
    })).toBe(conversationId);
    expect(getMessagingChangeConversationId({
      table: 'call_sessions',
      new: { conversation_id: conversationId },
    })).toBe(conversationId);
    expect(getMessagingChangeConversationId({ table: 'unknown', new: { id: 'other' } })).toBeNull();
  });

  it('uploads all parts before atomically creating a combined message', async () => {
    const repository = createRepository();
    const service = createMessagingService(repository);
    const message = await service.sendMessage({
      conversationId,
      text: 'Meet here',
      files: [image(), video()],
      location: { latitude: 3.1, longitude: 101.7 },
    });
    expect(message.messageTypes).toEqual(['text', 'image', 'video', 'location']);
    expect(repository.uploads).toHaveLength(2);
    expect(repository.getStoredMessages()).toHaveLength(1);
  });

  it('lists host or passenger Ride choices and sends a live invitation card', async () => {
    const repository = createRepository();
    const service = createMessagingService(repository);

    await expect(service.listRideInviteOptions(conversationId)).resolves.toEqual([
      expect.objectContaining({
        rideId: '20000000-0000-4000-8000-000000000099',
        sourceRole: 'passenger',
        canRequest: true,
      }),
    ]);

    const message = await service.sendRideInvitation({
      conversationId,
      rideId: '20000000-0000-4000-8000-000000000099',
      text: 'Want to join this Ride?',
    });
    expect(message).toMatchObject({
      text: 'Want to join this Ride?',
      messageTypes: ['text', 'ride_invitation'],
      canEdit: false,
      canDelete: true,
      rideInvitation: {
        rideId: '20000000-0000-4000-8000-000000000099',
        canRequest: true,
      },
    });
  });

  it('uploads and maps a standalone voice message with duration metadata', async () => {
    const repository = createRepository();
    const service = createMessagingService(repository);
    const message = await service.sendMessage({
      conversationId,
      voiceRecording: voiceRecording({
        file: file('voice.webm', 'audio/webm;codecs=opus', 2048),
        durationSeconds: 27,
      }),
    });
    expect(message.messageTypes).toEqual(['audio']);
    expect(message.attachments[0]).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/webm',
      durationSeconds: 27,
    });
    expect(repository.uploads).toHaveLength(1);
  });

  it('sends no message and cleans successful uploads when any upload fails', async () => {
    const repository = createRepository({ failUploadName: 'broken.mp4' });
    const service = createMessagingService(repository);
    await expect(service.sendMessage({ conversationId, files: [image('ok.jpg'), video('broken.mp4')] })).rejects.toThrow('upload failed');
    expect(repository.getStoredMessages()).toHaveLength(0);
    expect(repository.removedPaths).toHaveLength(1);
    expect(repository.removedPaths[0]).toMatch(new RegExp(`^${userId}/${conversationId}/[^/]+/[^/]+/ok\\.jpg$`));
  });

  it('returns history oldest-to-newest and searches text, system messages, and file names', async () => {
    const repository = createRepository({ messages: [
      rawMessage({ id: 'z', text_content: null, kind: 'system', sender_id: null, sender: null, created_at: '2026-08-10T03:00:00Z', text_content: 'Daniel left the group.' }),
      rawMessage({ id: 'a', created_at: '2026-08-10T01:00:00Z', text_content: 'Pickup point' }),
      rawMessage({ id: 'b', created_at: '2026-08-10T02:00:00Z', text_content: null, attachments: [{ id: 'att', kind: 'image', sort_order: 0, file_name: 'receipt.png', mime_type: 'image/png', file_size: 12 }] }),
    ] });
    const service = createMessagingService(repository);
    expect((await service.listMessages(conversationId)).map((item) => item.id)).toEqual(['a', 'b', 'z']);
    expect((await service.searchMessages(conversationId, 'left')).map((item) => item.id)).toEqual(['z']);
    expect((await service.searchMessages(conversationId, 'receipt')).map((item) => item.id)).toEqual(['b']);
  });

  it('allows personal deletion for received, read-only and deleted messages', () => {
    for (const row of [rawMessage({ sender_id: otherId }), rawMessage({ deleted_at: '2026-08-10T03:00:00Z' }), rawMessage({ kind: 'system', sender_id: null })]) {
      expect(mapMessageRow(row, { members: [], isReadOnly: true }, userId)).toMatchObject({
        canDelete: true, canDeleteForEveryone: false,
      });
    }
  });

  it('requires ownership and unread writable chat for every message type', () => {
    const cases = [
      [rawMessage(), { members: [] }, true],
      [rawMessage({ sender_id: otherId }), { members: [] }, false],
      [rawMessage(), { members: [{ id: otherId, lastReadAt: '2026-08-10T02:00:00Z' }] }, false],
      [rawMessage(), { members: [], interactionBlocked: true }, false],
      [rawMessage(), { members: [], isReadOnly: true }, false],
      [rawMessage({ attachments: [{ kind: 'audio' }] }), { members: [] }, true],
      [rawMessage({ ride_invitation: { ride_id: 'ride' } }), { members: [] }, true],
    ];
    for (const [row, conversation, allowed] of cases) {
      const mapped = mapMessageRow(row, conversation, userId);
      expect(mapped.canDeleteForEveryone).toBe(allowed);
    }
  });

  it('routes personal message and call deletion without deleting shared media', async () => {
    const repository = createRepository();
    repository.deleteForMe = vi.fn().mockResolvedValue(true);
    repository.deleteMessage = vi.fn();
    const service = createMessagingService(repository);
    await service.deleteForMe('message-id');
    await service.deleteForMe('call-id', 'call');
    expect(repository.deleteForMe.mock.calls).toEqual([['message-id', 'message'], ['call-id', 'call']]);
    expect(repository.deleteMessage).not.toHaveBeenCalled();
    expect(repository.removedPaths).toEqual([]);
  });

  it('preserves media when the atomic server read check rejects deletion', async () => {
    const repository = createRepository({ messages: [rawMessage()] });
    repository.getMessage = vi.fn();
    repository.getConversation = vi.fn();
    repository.deleteMessage = vi.fn().mockRejectedValue(new Error('This message has already been read'));
    await expect(createMessagingService(repository).deleteMessage(rawMessage().id)).rejects.toThrow('already been read');
    expect(repository.getMessage).not.toHaveBeenCalled();
    expect(repository.getConversation).not.toHaveBeenCalled();
    expect(repository.removedPaths).toEqual([]);
  });

  it('reuses the conversation and user already loaded during a timeline refresh', async () => {
    const repository = createRepository({ messages: [rawMessage()] });
    repository.getCurrentUserId = vi.fn();
    repository.getConversation = vi.fn();
    const messages = await createMessagingService(repository).listMessages(conversationId, {
      conversation: mapConversationRow(rawConversation(), userId), currentUserId: userId,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].canDeleteForEveryone).toBe(true);
    expect(repository.getCurrentUserId).not.toHaveBeenCalled();
    expect(repository.getConversation).not.toHaveBeenCalled();
  });

  it('deletes an eligible message for everyone', async () => {
    const repository = createRepository({ messages: [rawMessage()] });
    await createMessagingService(repository).deleteMessage(rawMessage().id);
    expect(repository.getStoredMessages()[0].deleted_at).toBeTruthy();
  });

  it('maps read-lock, edited and deleted state', () => {
    const conversation = {
      members: [{ id: userId }, { id: otherId, lastReadAt: '2026-08-10T02:00:00Z' }],
      isReadOnly: false,
    };
    const edited = mapMessageRow(rawMessage({ edited_at: '2026-08-10T01:30:00Z' }), conversation, userId);
    const deleted = mapMessageRow(rawMessage({ text_content: null, deleted_at: '2026-08-10T01:30:00Z' }), conversation, userId);
    expect(edited).toMatchObject({ isRead: true, canEdit: false, canDelete: true });
    expect(deleted).toMatchObject({ text: '', canEdit: false, canDelete: true, canDeleteForEveryone: false });
  });

  it('never exposes edit for voice messages and rejects direct edit attempts', async () => {
    const voiceMessage = rawMessage({
      attachments: [{
        id: 'voice',
        kind: 'audio',
        sort_order: 0,
        storage_path: `${userId}/${conversationId}/30000000-0000-4000-8000-000000000001/v1/voice.webm`,
        file_name: 'voice.webm',
        mime_type: 'audio/webm',
        file_size: 1024,
        duration_seconds: 8,
      }],
    });
    const mapped = mapMessageRow(voiceMessage, { members: [], isReadOnly: false }, userId);
    expect(mapped).toMatchObject({ canEdit: false, canDelete: true, canDeleteForEveryone: true });

    const service = createMessagingService(createRepository({ messages: [voiceMessage] }));
    await expect(service.editMessage({
      messageId: voiceMessage.id,
      text: 'replace',
    })).rejects.toThrow('Voice messages cannot be edited');
  });

  it('keeps the complete old version on edit failure and switches all parts on success', async () => {
    const original = rawMessage({ attachments: [{
      id: 'old', kind: 'image', sort_order: 0,
      storage_path: `${userId}/${conversationId}/30000000-0000-4000-8000-000000000001/v1/old.jpg`,
      file_name: 'old.jpg', mime_type: 'image/jpeg', file_size: 10,
    }] });
    const failedRepository = createRepository({ messages: [original], failEdit: true });
    const failedService = createMessagingService(failedRepository);
    await expect(failedService.editMessage({ messageId: original.id, text: 'New', existingAttachmentIds: [], newFiles: [image('new.jpg')] })).rejects.toThrow('read race');
    expect(failedRepository.getStoredMessages()[0].text_content).toBe('Hello');
    expect(failedRepository.getStoredMessages()[0].attachments[0].file_name).toBe('old.jpg');
    expect(failedRepository.removedPaths.some((path) => path.endsWith('/new.jpg'))).toBe(true);

    const repository = createRepository({ messages: [original] });
    const service = createMessagingService(repository);
    const edited = await service.editMessage({
      messageId: original.id,
      text: 'New',
      existingAttachmentIds: [],
      newFiles: [{ file: video('new.mp4'), clientId: 'replacement' }],
      mediaOrder: ['new:replacement'],
      location: { latitude: 4, longitude: 102 },
    });
    expect(edited.messageTypes).toEqual(['text', 'video', 'location']);
    expect(repository.removedPaths).toContain(`${userId}/${conversationId}/30000000-0000-4000-8000-000000000001/v1/old.jpg`);
  });
});
