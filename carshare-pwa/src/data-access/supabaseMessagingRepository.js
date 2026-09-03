// ===== DATA ACCESS LAYER (Supabase Messaging Repository) =====
import { supabase, isSupabaseConfigured } from './supabaseClient.js';

const MEDIA_BUCKET = 'message-media';
const SIGNED_URL_SECONDS = 60 * 60;
// Attachment mutations are committed with a messages or conversations change,
// so subscribing to them separately only produces duplicate refreshes.
const CORE_REALTIME_TABLES = [
  'conversations',
  'conversation_members',
  'messages',
  'call_sessions',
];
const LIFECYCLE_REALTIME_TABLES = ['friendships'];

const FRIEND_CONVERSATION_SELECT = `
  *,
  friendship:friendships!conversations_friendship_id_fkey(id, status, updated_at),
  ride:rides(id, host_id, pickup, destination, departure_at, status),
  members:conversation_members(
    conversation_id, user_id, role, joined_at, left_at, archived_at, deleted_before,
    access_expires_at, muted_at, last_read_at,
    profile:profiles(id, full_name, profile_photo_url, status)
  ),
  last_message:messages!conversations_last_message_id_fkey(
    id, sender_id, kind, text_content, created_at, edited_at, deleted_at,
    attachments:message_attachments(id, kind, file_name)
  )
`;

const CONVERSATION_SELECT = `
  *,
  ride:rides(id, host_id, pickup, destination, departure_at, status),
  members:conversation_members(
    conversation_id, user_id, role, joined_at, left_at, archived_at, deleted_before,
    access_expires_at, muted_at, last_read_at,
    profile:profiles(id, full_name, profile_photo_url, status)
  ),
  last_message:messages!conversations_last_message_id_fkey(
    id, sender_id, kind, text_content, created_at, edited_at, deleted_at,
    attachments:message_attachments(id, kind, file_name)
  )
`;

// Keep existing conversations readable while migration 075 is pending or
// PostgREST is still refreshing its schema cache. This is the exact shape used
// before the personal conversation-state columns were introduced.
const LEGACY_CONVERSATION_SELECT = `
  *,
  ride:rides(id, host_id, pickup, destination, departure_at, status),
  members:conversation_members(
    conversation_id, user_id, role, joined_at, left_at, archived_at, last_read_at,
    profile:profiles(id, full_name, profile_photo_url, status)
  ),
  last_message:messages!conversations_last_message_id_fkey(
    id, kind, text_content, created_at, edited_at, deleted_at,
    attachments:message_attachments(id, kind, file_name)
  )
`;

let lifecycleConversationSchemaAvailable = null;
let friendshipConversationSchemaAvailable = null;

const MESSAGE_SELECT = `
  *,
  sender:profiles!messages_sender_id_fkey(id, full_name, profile_photo_url),
  attachments:message_attachments(*)
`;

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Messaging requires a configured Supabase connection.');
  }
  return supabase;
}

function normalizeError(error, fallback) {
  const message = error?.message?.replace(/^.*?: /, '') || fallback;
  return Object.assign(new Error(message), { code: error?.code });
}

export function isMissingConversationLifecycleSchema(error) {
  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ');
  return ['PGRST200', 'PGRST204', '42703', '42P01'].includes(error?.code)
    && /deleted_before|access_expires_at|muted_at/i.test(details);
}

export function isMissingFriendshipConversationSchema(error) {
  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ');
  return ['PGRST200', 'PGRST204', 'PGRST205', '42703', '42P01'].includes(error?.code)
    && /friendships|friendship_id|scope|conversations_friendship_id_fkey/i.test(details);
}

async function loadConversationRows(client, conversationId = null) {
  const run = (select) => {
    let query = client.from('conversations').select(select);
    if (conversationId) return query.eq('id', conversationId).maybeSingle();
    query = query.order('last_message_at', { ascending: false, nullsFirst: false });
    return query.order('created_at', { ascending: false });
  };

  if (friendshipConversationSchemaAvailable !== false) {
    const friendshipResult = await run(FRIEND_CONVERSATION_SELECT);
    if (!friendshipResult.error) {
      friendshipConversationSchemaAvailable = true;
      lifecycleConversationSchemaAvailable = true;
      return friendshipResult;
    }
    if (isMissingConversationLifecycleSchema(friendshipResult.error)) {
      friendshipConversationSchemaAvailable = false;
      lifecycleConversationSchemaAvailable = false;
      return run(LEGACY_CONVERSATION_SELECT);
    }
    if (!isMissingFriendshipConversationSchema(friendshipResult.error)) {
      return friendshipResult;
    }
    friendshipConversationSchemaAvailable = false;
  }

  if (lifecycleConversationSchemaAvailable === false) {
    return run(LEGACY_CONVERSATION_SELECT);
  }

  const result = await run(CONVERSATION_SELECT);
  if (!result.error) {
    lifecycleConversationSchemaAvailable = true;
    return result;
  }
  if (!isMissingConversationLifecycleSchema(result.error)) return result;

  lifecycleConversationSchemaAvailable = false;
  return run(LEGACY_CONVERSATION_SELECT);
}

async function normalizeFunctionError(error, fallback) {
  let payload = null;
  try {
    payload = await error?.context?.json?.();
  } catch {
    // A network or gateway error may not include a JSON response body.
  }
  const message = payload?.error || error?.message?.replace(/^.*?: /, '') || fallback;
  return Object.assign(new Error(message), {
    code: payload?.code || error?.code || 'TRANSLATION_FAILED',
  });
}

async function requireUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw normalizeError(error, 'Authentication required.');
  }
  return data.user.id;
}

function getSignedUrl(data) {
  return data?.signedUrl || data?.signedURL || null;
}

function getStorageErrorMessage(error, fallback) {
  if (typeof error === 'string') return error;
  return error?.message || fallback;
}

function storageMimeType(value) {
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
}

export async function attachSignedUrls(rows, client = requireSupabase()) {
  const paths = [...new Set(rows.flatMap((row) =>
    (row.attachments || [])
      .filter((attachment) => attachment.storage_path)
      .map((attachment) => attachment.storage_path),
  ))];

  if (!paths.length) return rows;

  const bucket = client.storage.from(MEDIA_BUCKET);
  const { data, error } = await bucket.createSignedUrls(paths, SIGNED_URL_SECONDS);

  if (error) throw normalizeError(error, 'Unable to load message media.');
  const urlsByPath = new Map();
  const errorsByPath = new Map();

  (data || []).forEach((item, index) => {
    const path = paths.includes(item?.path) ? item.path : paths[index];
    if (!path) return;
    const signedUrl = getSignedUrl(item);
    if (signedUrl) {
      urlsByPath.set(path, signedUrl);
    } else {
      errorsByPath.set(
        path,
        getStorageErrorMessage(item?.error, 'No signed URL was returned.'),
      );
    }
  });

  // Batch signing can succeed at the HTTP level while individual entries contain
  // an error and a null URL. Retry only those entries with the single-file API so
  // one bad attachment cannot leave every media tile blank.
  await Promise.all(paths.filter((path) => !urlsByPath.has(path)).map(async (path) => {
    const { data: signedData, error: signedError } = await bucket.createSignedUrl(
      path,
      SIGNED_URL_SECONDS,
    );
    const signedUrl = getSignedUrl(signedData);
    if (signedUrl) {
      urlsByPath.set(path, signedUrl);
      errorsByPath.delete(path);
      return;
    }
    errorsByPath.set(
      path,
      getStorageErrorMessage(signedError, errorsByPath.get(path) || 'Unable to load this media.'),
    );
  }));

  return rows.map((row) => ({
    ...row,
    attachments: (row.attachments || []).map((attachment) => ({
      ...attachment,
      signed_url: attachment.storage_path
        ? urlsByPath.get(attachment.storage_path) || null
        : null,
      media_error: attachment.storage_path
        ? errorsByPath.get(attachment.storage_path) || null
        : null,
    })),
  }));
}

export async function attachLatestCallActivity(rows, client = requireSupabase()) {
  const conversations = Array.isArray(rows) ? rows : rows ? [rows] : [];
  if (!conversations.length) return rows;

  const { data, error } = await client
    .from('call_sessions')
    .select('id, conversation_id, caller_id, callee_id, call_type, status, created_at')
    .in('conversation_id', conversations.map((conversation) => conversation.id))
    .order('created_at', { ascending: false });

  // Voice calling was introduced after messaging. Keep older deployments able
  // to load their conversation list when call_sessions is not available yet.
  if (error) return rows;

  const latestByConversation = new Map();
  (data || []).forEach((call) => {
    if (!latestByConversation.has(call.conversation_id)) {
      latestByConversation.set(call.conversation_id, call);
    }
  });
  const enriched = conversations.map((conversation) => ({
    ...conversation,
    latest_call: latestByConversation.get(conversation.id) || null,
  }));
  return Array.isArray(rows) ? enriched : enriched[0];
}

export const supabaseMessagingRepository = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  async getCurrentUserId() {
    return requireUserId();
  },

  async openRideDirectConversation(rideId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('open_ride_direct_conversation', {
      p_ride_id: rideId,
    });
    if (error) throw normalizeError(error, 'Unable to start this conversation.');
    return data;
  },

  async listConversations() {
    const client = requireSupabase();
    const userId = await requireUserId();
    const { data, error } = await loadConversationRows(client);
    if (error) throw normalizeError(error, 'Unable to load conversations.');
    const conversations = data || [];
    if (!conversations.length) return conversations;

    const [messageResult, conversationsWithCalls] = await Promise.all([
      client
        .from('messages')
        .select('conversation_id, sender_id, created_at')
        .in('conversation_id', conversations.map((conversation) => conversation.id)),
      attachLatestCallActivity(conversations, client),
    ]);
    const { data: messageMeta, error: messageError } = messageResult;
    if (messageError) {
      throw normalizeError(messageError, 'Unable to load unread messages.');
    }

    return conversationsWithCalls.map((conversation) => {
      const membership = (conversation.members || []).find(
        (member) => member.user_id === userId,
      );
      const lastReadAt = membership?.last_read_at
        ? new Date(membership.last_read_at).getTime()
        : 0;
      const unreadCount = (messageMeta || []).filter((message) =>
        message.conversation_id === conversation.id
        && message.sender_id !== userId
        && new Date(message.created_at).getTime() > lastReadAt,
      ).length;
      return { ...conversation, unread_count: unreadCount };
    });
  },

  async getConversation(conversationId) {
    const client = requireSupabase();
    const { data, error } = await loadConversationRows(client, conversationId);
    if (error) throw normalizeError(error, 'Unable to load this conversation.');
    return attachLatestCallActivity(data, client);
  },

  async listMessages(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw normalizeError(error, 'Unable to load messages.');
    return attachSignedUrls(data || []);
  },

  async getMessage(messageId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('id', messageId)
      .maybeSingle();
    if (error) throw normalizeError(error, 'Unable to load this message.');
    if (!data) return null;
    const [message] = await attachSignedUrls([data]);
    return message;
  },

  async uploadMedia({ conversationId, messageId, versionId, file }) {
    const client = requireSupabase();
    const userId = await requireUserId();
    const extension = file.name.includes('.')
      ? `.${file.name.split('.').pop().toLowerCase()}`
      : '';
    const objectId = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const storagePath = `${userId}/${conversationId}/${messageId}/${versionId}/${objectId}${extension}`;
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(
      storagePath,
      file,
      {
        cacheControl: '3600',
        contentType: storageMimeType(file.type),
        upsert: false,
      },
    );
    if (error) throw normalizeError(error, `Unable to upload ${file.name}.`);
    return storagePath;
  },

  async removeMedia(paths) {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (!cleanPaths.length) return true;
    const client = requireSupabase();
    const { error } = await client.storage.from(MEDIA_BUCKET).remove(cleanPaths);
    if (error) throw normalizeError(error, 'Unable to remove message media.');
    return true;
  },

  async sendMessage({ conversationId, messageId, text, attachments }) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('send_message', {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_text: text || null,
      p_attachments: attachments,
    });
    if (error) throw normalizeError(error, 'Unable to send message.');
    return data;
  },

  async editMessage({ messageId, text, attachments }) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('edit_message', {
      p_message_id: messageId,
      p_text: text || null,
      p_attachments: attachments,
    });
    if (error) throw normalizeError(error, 'Unable to edit message.');
    return data;
  },

  async deleteMessage(messageId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('delete_message', {
      p_message_id: messageId,
    });
    if (error) throw normalizeError(error, 'Unable to delete message.');
    return data || [];
  },

  async translateMessage({ messageId, targetLanguage }) {
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke('m3-message-translation', {
      body: { messageId, targetLanguage },
    });
    if (error) throw await normalizeFunctionError(error, 'Unable to translate this message.');
    if (!data?.translatedText) {
      throw Object.assign(new Error('Translation returned no text.'), {
        code: 'AI_INVALID_RESPONSE',
      });
    }
    return data;
  },

  async markConversationRead(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
    });
    if (error) throw normalizeError(error, 'Unable to update read status.');
    return data;
  },

  async archiveConversation(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('archive_conversation', {
      p_conversation_id: conversationId,
    });
    if (error) throw normalizeError(error, 'Unable to archive conversation.');
    return data;
  },

  async unarchiveConversation(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('unarchive_conversation', {
      p_conversation_id: conversationId,
    });
    if (error) throw normalizeError(error, 'Unable to unarchive conversation.');
    return data;
  },

  async deleteConversationForMe(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('delete_conversation_for_me', {
      p_conversation_id: conversationId,
    });
    if (error) throw normalizeError(error, 'Unable to delete this chat for you.');
    return attachLatestCallActivity(data, client);
  },

  async setConversationMuted(conversationId, muted) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('set_conversation_muted', {
      p_conversation_id: conversationId,
      p_muted: Boolean(muted),
    });
    if (error) throw normalizeError(error, muted
      ? 'Unable to mute this conversation.'
      : 'Unable to unmute this conversation.');
    return data;
  },

  subscribe(listener) {
    if (!isSupabaseConfigured || !supabase) {
      return () => {};
    }
    const client = supabase;
    let coreChannel = client.channel(`messaging-core-${Date.now()}-${Math.random()}`);
    CORE_REALTIME_TABLES
      .forEach((table) => {
        coreChannel = coreChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          listener,
        );
      });
    coreChannel.subscribe();

    // Optional friendship tables use a separate channel. If migration 079 has
    // not reached the database yet, Realtime can reject this channel without
    // taking down message/conversation refreshes on the core channel.
    let lifecycleChannel = client.channel(`messaging-lifecycle-${Date.now()}-${Math.random()}`);
    LIFECYCLE_REALTIME_TABLES.forEach((table) => {
      lifecycleChannel = lifecycleChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        listener,
      );
    });
    lifecycleChannel.subscribe();
    return () => {
      void client.removeChannel(coreChannel);
      void client.removeChannel(lifecycleChannel);
    };
  },
};
