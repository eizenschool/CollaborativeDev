// ===== DATA ACCESS LAYER (Supabase Messaging Repository) =====
import { supabase, isSupabaseConfigured } from './supabaseClient.js';

const MEDIA_BUCKET = 'message-media';
const SIGNED_URL_SECONDS = 60 * 60;
// Attachment mutations are committed with a messages or conversations change,
// so subscribing to them separately only produces duplicate refreshes.
const REALTIME_TABLES = ['conversations', 'conversation_members', 'messages'];

const CONVERSATION_SELECT = `
  *,
  ride:rides(id, host_id, pickup, destination, departure_at, status),
  members:conversation_members(
    conversation_id, user_id, role, joined_at, left_at, archived_at, last_read_at,
    profile:profiles(id, full_name, profile_photo_url)
  ),
  last_message:messages!conversations_last_message_id_fkey(
    id, kind, text_content, created_at, edited_at, deleted_at,
    attachments:message_attachments(id, kind, file_name)
  )
`;

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

async function requireUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw normalizeError(error, 'Authentication required.');
  }
  return data.user.id;
}

async function attachSignedUrls(rows) {
  const paths = rows.flatMap((row) =>
    (row.attachments || [])
      .filter((attachment) => attachment.storage_path)
      .map((attachment) => attachment.storage_path),
  );

  if (!paths.length) return rows;

  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);

  if (error) throw normalizeError(error, 'Unable to load message media.');
  const urlsByPath = new Map(
    (data || []).map((item, index) => [paths[index], item.signedUrl || null]),
  );

  return rows.map((row) => ({
    ...row,
    attachments: (row.attachments || []).map((attachment) => ({
      ...attachment,
      signed_url: attachment.storage_path
        ? urlsByPath.get(attachment.storage_path) || null
        : null,
    })),
  }));
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
    const { data, error } = await client
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw normalizeError(error, 'Unable to load conversations.');
    const conversations = data || [];
    if (!conversations.length) return conversations;

    const { data: messageMeta, error: messageError } = await client
      .from('messages')
      .select('conversation_id, sender_id, created_at')
      .in('conversation_id', conversations.map((conversation) => conversation.id));
    if (messageError) {
      throw normalizeError(messageError, 'Unable to load unread messages.');
    }

    return conversations.map((conversation) => {
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
    const { data, error } = await client
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw normalizeError(error, 'Unable to load this conversation.');
    return data;
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
        contentType: file.type,
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

  async leaveGroup(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('leave_group_conversation', {
      p_conversation_id: conversationId,
    });
    if (error) throw normalizeError(error, 'Unable to leave group.');
    return data;
  },

  subscribe(listener) {
    if (!isSupabaseConfigured || !supabase) {
      return () => {};
    }
    const client = supabase;
    let channel = client.channel(`messaging-${Date.now()}-${Math.random()}`);
    REALTIME_TABLES
      .forEach((table) => {
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          listener,
        );
      });
    channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  },
};
