// ===== BUSINESS LOGIC LAYER (MessagingService) =====
import { supabaseMessagingRepository } from '../data-access/supabaseMessagingRepository.js';

export const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  LOCATION: 'location',
  SYSTEM: 'system',
};

export const CONVERSATION_TYPE = {
  DIRECT: 'direct',
  GROUP: 'group',
};

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_MEDIA_COUNT = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_MESSAGE_MEDIA_BYTES = 100 * 1024 * 1024;

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

function cleanText(text) {
  return typeof text === 'string' ? text.trim() : '';
}

function mediaKind(file) {
  if (IMAGE_MIME_TYPES.includes(file?.type)) return MESSAGE_TYPE.IMAGE;
  if (VIDEO_MIME_TYPES.includes(file?.type)) return MESSAGE_TYPE.VIDEO;
  return null;
}

export function validateLocation(location) {
  if (location == null) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Shared location coordinates are invalid.');
  }
  return { latitude, longitude };
}

export function validateMessageDraft({ text, files = [], location = null }) {
  const messageText = cleanText(text);
  const mediaFiles = files.map((item) => item?.file || item);

  if (messageText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must not exceed ${MAX_MESSAGE_LENGTH} characters.`);
  }
  if (mediaFiles.length > MAX_MEDIA_COUNT) {
    throw new Error(`A message can contain at most ${MAX_MEDIA_COUNT} photos or videos.`);
  }

  let totalBytes = 0;
  mediaFiles.forEach((file) => {
    const kind = mediaKind(file);
    if (!kind) {
      throw new Error(`${file?.name || 'This file'} is not a supported photo or video.`);
    }
    if (kind === MESSAGE_TYPE.IMAGE && file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} exceeds the 10 MB image limit.`);
    }
    if (kind === MESSAGE_TYPE.VIDEO && file.size > MAX_VIDEO_BYTES) {
      throw new Error(`${file.name} exceeds the 50 MB video limit.`);
    }
    totalBytes += file.size;
  });

  if (totalBytes > MAX_MESSAGE_MEDIA_BYTES) {
    throw new Error('Message media must not exceed 100 MB in total.');
  }

  const cleanLocation = validateLocation(location);
  if (!messageText && !mediaFiles.length && !cleanLocation) {
    throw new Error('Add text, media, or a location before sending.');
  }

  return { text: messageText, files: mediaFiles, location: cleanLocation };
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp));
}

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  const value = new Date(timestamp);
  const now = new Date();
  if (value.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('en-MY', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kuala_Lumpur',
    }).format(value);
  }
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(value);
}

function formatTripDate(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp));
}

function formatTripTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp));
}

function mapMember(row) {
  return {
    id: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    archivedAt: row.archived_at,
    lastReadAt: row.last_read_at,
    name: row.profile?.full_name || 'Member',
    avatarUrl: row.profile?.profile_photo_url || null,
  };
}

function messagePreview(message) {
  if (!message) return 'No messages yet';
  if (message.deleted_at) return 'message deleted';
  if (message.text_content) return message.text_content;
  const kinds = (message.attachments || []).map((item) => item.kind);
  if (kinds.includes(MESSAGE_TYPE.IMAGE)) return 'Photo';
  if (kinds.includes(MESSAGE_TYPE.VIDEO)) return 'Video';
  if (kinds.includes(MESSAGE_TYPE.LOCATION)) return 'Location';
  return message.kind === 'system' ? 'Group update' : 'Message';
}

export function mapConversationRow(row, currentUserId) {
  const allMembers = (row.members || []).map(mapMember);
  const members = allMembers.filter((member) => !member.leftAt);
  const currentMembership = allMembers.find((member) => member.id === currentUserId);
  const otherMember = members.find((member) => member.id !== currentUserId);
  const route = row.trip_route
    || [row.ride?.pickup, row.ride?.destination].filter(Boolean).join(' to ')
    || null;
  const title = row.type === CONVERSATION_TYPE.GROUP
    ? row.title || `${route || 'Ride'} Trip Group`
    : otherMember?.name || 'Private conversation';
  const lastMessage = Array.isArray(row.last_message)
    ? row.last_message[0]
    : row.last_message;
  const lastAt = lastMessage?.created_at || row.last_message_at || row.created_at;

  return {
    id: row.id,
    rideId: row.ride_id,
    type: row.type,
    title,
    members,
    currentMembership,
    isArchived: Boolean(currentMembership?.archivedAt),
    isReadOnly: Boolean(currentMembership?.archivedAt),
    rideStatus: row.ride_status,
    expiresAt: row.expires_at,
    tripRoute: route,
    tripDate: formatTripDate(row.trip_departure_at),
    tripTime: formatTripTime(row.trip_departure_at),
    lastMessage: messagePreview(lastMessage),
    lastMessageAt: lastAt,
    lastTime: formatConversationTime(lastAt),
    unreadCount: row.unread_count || 0,
  };
}

function mapAttachment(row) {
  return {
    id: row.id,
    kind: row.kind,
    sortOrder: row.sort_order,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    latitude: row.latitude,
    longitude: row.longitude,
    url: row.signed_url || null,
    loadError: row.media_error || null,
  };
}

export function mapMessageRow(row, conversation, currentUserId) {
  const attachments = (row.attachments || [])
    .map(mapAttachment)
    .sort((first, second) => first.sortOrder - second.sortOrder);
  const messageTypes = [];
  if (row.kind === 'system') messageTypes.push(MESSAGE_TYPE.SYSTEM);
  if (row.text_content) messageTypes.push(MESSAGE_TYPE.TEXT);
  attachments.forEach((attachment) => {
    if (!messageTypes.includes(attachment.kind)) messageTypes.push(attachment.kind);
  });
  const sender = row.sender;
  const isRead = Boolean(
    conversation?.members?.some((member) =>
      member.id !== row.sender_id
      && member.lastReadAt
      && new Date(member.lastReadAt) >= new Date(row.created_at),
    ),
  );

  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    text: row.text_content || '',
    senderId: row.sender_id,
    senderName: sender?.full_name || (row.kind === 'system' ? 'System' : 'Member'),
    senderAvatar: sender?.profile_photo_url || null,
    attachments,
    messageTypes,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    timestamp: formatMessageTime(row.created_at),
    isRead,
    canEdit: row.sender_id === currentUserId
      && !row.deleted_at
      && !isRead
      && !conversation?.isReadOnly,
    canDelete: row.sender_id === currentUserId
      && !row.deleted_at
      && !conversation?.isReadOnly,
  };
}

function fileDescriptor(file, storagePath, sortOrder) {
  return {
    kind: mediaKind(file),
    sort_order: sortOrder,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
  };
}

function locationDescriptor(location) {
  if (!location) return null;
  return {
    kind: MESSAGE_TYPE.LOCATION,
    sort_order: 10,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

function createUuid() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This browser cannot create secure message identifiers.');
  }
  return globalThis.crypto.randomUUID();
}

async function uploadAll(repository, conversationId, messageId, versionId, fileEntries) {
  const results = await Promise.allSettled(fileEntries.map(async (entry) => ({
    entry,
    storagePath: await repository.uploadMedia({
      conversationId,
      messageId,
      versionId,
      file: entry.file,
    }),
  })));
  const uploaded = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    await repository.removeMedia(uploaded.map((item) => item.storagePath)).catch(() => {});
    throw failed.reason;
  }
  return uploaded;
}

function containsKeyword(message, keyword) {
  const normalized = keyword.toLocaleLowerCase();
  return message.text.toLocaleLowerCase().includes(normalized)
    || message.senderName.toLocaleLowerCase().includes(normalized)
    || message.attachments.some((attachment) =>
      attachment.fileName?.toLocaleLowerCase().includes(normalized),
    );
}

export function getMessagingChangeConversationId(change) {
  const row = change?.new && Object.keys(change.new).length
    ? change.new
    : change?.old;
  if (!row) return null;
  if (change.table === 'conversations') return row.id || null;
  if (['conversation_members', 'messages'].includes(change.table)) {
    return row.conversation_id || null;
  }
  return null;
}

/** Creates the Module 3 service against a compatible data repository. */
export function createMessagingService(repository = supabaseMessagingRepository) {
  return {
    backend: repository.backend,

    async openRideDirectConversation(rideId) {
      if (!rideId) throw new Error('A ride is required to start a conversation.');
      return repository.openRideDirectConversation(rideId);
    },

    async listConversations(folder = 'active') {
      if (!['active', 'archived'].includes(folder)) {
        throw new Error('Unsupported conversation folder.');
      }
      const currentUserId = await repository.getCurrentUserId();
      const rows = await repository.listConversations();
      return rows
        .map((row) => mapConversationRow(row, currentUserId))
        .filter((conversation) =>
          folder === 'archived' ? conversation.isArchived : !conversation.isArchived,
        )
        .sort((first, second) =>
          new Date(second.lastMessageAt) - new Date(first.lastMessageAt),
        );
    },

    async getConversation(conversationId) {
      const currentUserId = await repository.getCurrentUserId();
      const row = await repository.getConversation(conversationId);
      return row ? mapConversationRow(row, currentUserId) : null;
    },

    async listMessages(conversationId) {
      const currentUserId = await repository.getCurrentUserId();
      const conversation = await this.getConversation(conversationId);
      if (!conversation) throw new Error('Unable to load messages.');
      const rows = await repository.listMessages(conversationId);
      return rows
        .map((row) => mapMessageRow(row, conversation, currentUserId))
        .sort((first, second) => {
          const timeDifference = new Date(first.createdAt) - new Date(second.createdAt);
          return timeDifference || first.id.localeCompare(second.id);
        });
    },

    async searchMessages(conversationId, keyword) {
      const query = cleanText(keyword);
      const messages = await this.listMessages(conversationId);
      if (!query) return messages;
      return messages.filter((message) => containsKeyword(message, query));
    },

    async sendMessage({ conversationId, text, files = [], location = null }) {
      const draft = validateMessageDraft({ text, files, location });
      const fileEntries = draft.files.map((file, index) => ({
        file,
        clientId: `new-${index}`,
      }));
      const messageId = createUuid();
      const versionId = createUuid();
      const uploaded = await uploadAll(
        repository,
        conversationId,
        messageId,
        versionId,
        fileEntries,
      );
      const attachments = uploaded.map(({ entry, storagePath }, index) =>
        fileDescriptor(entry.file, storagePath, index),
      );
      const locationItem = locationDescriptor(draft.location);
      if (locationItem) attachments.push(locationItem);

      try {
        const savedMessageId = await repository.sendMessage({
          conversationId,
          messageId,
          text: draft.text,
          attachments,
        });
        const [currentUserId, conversation, row] = await Promise.all([
          repository.getCurrentUserId(),
          this.getConversation(conversationId),
          repository.getMessage(savedMessageId),
        ]);
        return mapMessageRow(row, conversation, currentUserId);
      } catch (error) {
        await repository.removeMedia(uploaded.map((item) => item.storagePath)).catch(() => {});
        throw error;
      }
    },

    async editMessage({
      messageId,
      text,
      existingAttachmentIds = [],
      newFiles = [],
      location = null,
      mediaOrder = [],
    }) {
      const original = await repository.getMessage(messageId);
      if (!original) throw new Error('Message not found.');
      const originalMedia = (original.attachments || []).filter(
        (attachment) => attachment.kind !== MESSAGE_TYPE.LOCATION,
      );
      const existingById = new Map(originalMedia.map((item) => [item.id, item]));
      const selectedExisting = existingAttachmentIds.map((id) => {
        const attachment = existingById.get(id);
        if (!attachment) throw new Error('An existing attachment is unavailable.');
        return attachment;
      });
      const normalizedNewFiles = newFiles.map((item, index) => ({
        file: item.file || item,
        clientId: item.clientId || `new-${index}`,
      }));
      const draft = validateMessageDraft({
        text,
        files: [
          ...selectedExisting.map((item) => ({
            name: item.file_name || item.fileName,
            type: item.mime_type || item.mimeType,
            size: Number(item.file_size || item.fileSize),
          })),
          ...normalizedNewFiles.map((item) => item.file),
        ],
        location,
      });
      const uploaded = await uploadAll(
        repository,
        original.conversation_id,
        messageId,
        createUuid(),
        normalizedNewFiles,
      );
      try {
        const newByClientId = new Map(uploaded.map((item) => [item.entry.clientId, item]));
        const defaultOrder = [
          ...selectedExisting.map((item) => `existing:${item.id}`),
          ...normalizedNewFiles.map((item) => `new:${item.clientId}`),
        ];
        const requestedOrder = mediaOrder.length ? mediaOrder : defaultOrder;
        const attachments = requestedOrder.map((token, index) => {
          const [source, id] = token.split(':');
          if (source === 'existing') {
            const item = existingById.get(id);
            if (!item || !existingAttachmentIds.includes(id)) {
              throw new Error('An attachment order item is invalid.');
            }
            return {
              kind: item.kind,
              sort_order: index,
              storage_path: item.storage_path || item.storagePath,
              file_name: item.file_name || item.fileName,
              mime_type: item.mime_type || item.mimeType,
              file_size: Number(item.file_size || item.fileSize),
            };
          }
          const uploadedItem = newByClientId.get(id);
          if (!uploadedItem) throw new Error('A new attachment order item is invalid.');
          return fileDescriptor(uploadedItem.entry.file, uploadedItem.storagePath, index);
        });
        const locationItem = locationDescriptor(draft.location);
        if (locationItem) attachments.push(locationItem);

        await repository.editMessage({ messageId, text: draft.text, attachments });

        const keptPaths = new Set(attachments.map((item) => item.storage_path).filter(Boolean));
        const removedPaths = originalMedia
          .map((item) => item.storage_path || item.storagePath)
          .filter((path) => path && !keptPaths.has(path));
        await repository.removeMedia(removedPaths).catch(() => {});
      } catch (error) {
        await repository.removeMedia(uploaded.map((item) => item.storagePath)).catch(() => {});
        throw error;
      }
      const [currentUserId, conversation, row] = await Promise.all([
        repository.getCurrentUserId(),
        this.getConversation(original.conversation_id),
        repository.getMessage(messageId),
      ]);
      return mapMessageRow(row, conversation, currentUserId);
    },

    async deleteMessage(messageId) {
      const paths = await repository.deleteMessage(messageId);
      await repository.removeMedia(paths).catch(() => {});
      return true;
    },

    async markConversationRead(conversationId) {
      return repository.markConversationRead(conversationId);
    },

    async archiveConversation(conversationId) {
      return repository.archiveConversation(conversationId);
    },

    async leaveGroup(conversationId) {
      return repository.leaveGroup(conversationId);
    },

    subscribeToMessaging(listener) {
      return repository.subscribe(listener);
    },

    subscribe(listener) {
      return repository.subscribe(listener);
    },
  };
}

export const MessagingService = createMessagingService();
