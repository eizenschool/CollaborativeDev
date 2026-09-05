import { describe, expect, it, vi } from 'vitest';
import {
  attachLatestCallActivity,
  attachSignedUrls,
  isMissingConversationLifecycleSchema,
  isMissingFriendshipConversationSchema,
  isMissingRideInvitationSchema,
} from '../../data-access/supabaseMessagingRepository.js';

function callActivityClient({ data = [], error = null } = {}) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  return { from: vi.fn(() => query) };
}

function messageWithAttachments(paths) {
  return [{
    id: 'message-1',
    attachments: paths.map((path, index) => ({
      id: `attachment-${index}`,
      kind: 'image',
      storage_path: path,
      file_name: `photo-${index}.png`,
    })),
  }];
}

function storageClient({ batchData, singleResults = {} }) {
  const bucket = {
    createSignedUrls: vi.fn().mockResolvedValue({ data: batchData, error: null }),
    createSignedUrl: vi.fn(async (path) => singleResults[path] || {
      data: null,
      error: { message: 'Access denied' },
    }),
  };
  return {
    bucket,
    client: { storage: { from: vi.fn(() => bucket) } },
  };
}

describe('message media signed URLs', () => {
  it('keeps photo URLs stable across refreshes and renews them before expiry', async () => {
    const path = 'user/conversation/message/version/photo.png';
    const { client, bucket } = storageClient({ batchData: [{ path, signedUrl: 'https://storage.test/first' }] });
    vi.useFakeTimers();
    try {
      const rows = messageWithAttachments([path]);
      const first = await attachSignedUrls(rows, client);
      const second = await attachSignedUrls(rows, client);
      expect(second).toEqual(first);
      expect(bucket.createSignedUrls).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60 * 60 * 1000);
      bucket.createSignedUrls.mockResolvedValue({ data: [{ path, signedUrl: 'https://storage.test/renewed' }], error: null });
      const renewed = await attachSignedUrls(rows, client);
      expect(renewed[0].attachments[0].signed_url).toBe('https://storage.test/renewed');
      expect(bucket.createSignedUrls).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs only new versioned paths and never returns a removed attachment', async () => {
    const oldPath = 'user/conversation/message/v1/photo.png';
    const newPath = 'user/conversation/message/v2/photo.png';
    const { client, bucket } = storageClient({ batchData: [{ path: oldPath, signedUrl: 'https://storage.test/old' }] });
    await attachSignedUrls(messageWithAttachments([oldPath]), client);
    bucket.createSignedUrls.mockResolvedValue({ data: [{ path: newPath, signedUrl: 'https://storage.test/new' }], error: null });
    const rows = await attachSignedUrls(messageWithAttachments([newPath]), client);
    expect(bucket.createSignedUrls.mock.calls[1][0]).toEqual([newPath]);
    expect(rows[0].attachments).toHaveLength(1);
    expect(rows[0].attachments[0].signed_url).toBe('https://storage.test/new');
    expect(await attachSignedUrls([{ id: 'deleted', attachments: [] }], client)).toEqual([{ id: 'deleted', attachments: [] }]);
  });

  it('maps batch results by returned path instead of response order', async () => {
    const firstPath = 'user/conversation/message/version/first.png';
    const secondPath = 'user/conversation/message/version/second.png';
    const { client, bucket } = storageClient({ batchData: [
      { path: secondPath, signedUrl: 'https://storage.test/second' },
      { path: firstPath, signedUrl: 'https://storage.test/first' },
    ] });

    const [message] = await attachSignedUrls(
      messageWithAttachments([firstPath, secondPath]),
      client,
    );

    expect(message.attachments.map((attachment) => attachment.signed_url)).toEqual([
      'https://storage.test/first',
      'https://storage.test/second',
    ]);
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('retries a per-file batch failure with the single-file signing API', async () => {
    const path = 'user/conversation/message/version/photo.png';
    const { client, bucket } = storageClient({
      batchData: [{ path, signedUrl: null, error: 'Object unavailable' }],
      singleResults: {
        [path]: { data: { signedURL: 'https://storage.test/recovered' }, error: null },
      },
    });

    const [message] = await attachSignedUrls(messageWithAttachments([path]), client);

    expect(bucket.createSignedUrl).toHaveBeenCalledWith(path, 3600);
    expect(message.attachments[0]).toMatchObject({
      signed_url: 'https://storage.test/recovered',
      media_error: null,
    });
  });

  it('keeps the conversation readable when one media file cannot be signed', async () => {
    const path = 'user/conversation/message/version/missing.png';
    const { client } = storageClient({
      batchData: [{ path, signedUrl: null, error: 'Object unavailable' }],
    });

    const [message] = await attachSignedUrls(messageWithAttachments([path]), client);

    expect(message.attachments[0]).toMatchObject({
      signed_url: null,
      media_error: 'Access denied',
    });
  });
});

describe('conversation lifecycle schema compatibility', () => {
  it('recognizes an undeployed Ride invitation table or RPC', () => {
    expect(isMissingRideInvitationSchema({
      code: '42P01',
      message: 'relation message_ride_invitations does not exist',
    })).toBe(true);
    expect(isMissingRideInvitationSchema({
      code: 'PGRST202',
      message: 'Could not find the function public.list_friend_ride_invite_options',
    })).toBe(true);
  });

  it('recognizes a missing friendship relation without disabling ride messages', () => {
    expect(isMissingFriendshipConversationSchema({
      code: 'PGRST200',
      message: 'Could not find a relationship between conversations and friendships in the schema cache',
    })).toBe(true);
  });

  it('keeps both staged compatibility fallbacks in the conversation loader', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../data-access/supabaseMessagingRepository.js', import.meta.url),
      'utf8',
    ));
    expect(source).toContain('if (isMissingConversationLifecycleSchema(friendshipResult.error))');
    expect(source).toContain('return run(LEGACY_CONVERSATION_SELECT)');
  });

  it('recognizes a missing lifecycle column in an un-migrated Supabase schema cache', () => {
    expect(isMissingConversationLifecycleSchema({
      code: '42703',
      message: 'column conversation_members.muted_at does not exist',
    })).toBe(true);
  });

  it('does not hide unrelated conversation query failures behind the legacy fallback', () => {
    expect(isMissingConversationLifecycleSchema({
      code: '42501',
      message: 'permission denied for table conversations',
    })).toBe(false);
  });
});

describe('conversation call activity', () => {
  it('enriches both list and single-conversation reads with latest call activity', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../data-access/supabaseMessagingRepository.js', import.meta.url),
      'utf8',
    ));

    expect(source).toMatch(/async getConversation\(conversationId\)[\s\S]*?return attachLatestCallActivity\(data, client\);/);
  });

  it('attaches only the newest call to each conversation', async () => {
    const client = callActivityClient({ data: [
      { id: 'new', conversation_id: 'conversation-1', created_at: '2026-08-10T02:00:00Z' },
      { id: 'old', conversation_id: 'conversation-1', created_at: '2026-08-10T01:00:00Z' },
      { id: 'other', conversation_id: 'conversation-2', created_at: '2026-08-10T03:00:00Z' },
    ] });

    const rows = await attachLatestCallActivity([
      { id: 'conversation-1' },
      { id: 'conversation-2' },
    ], client);

    expect(rows.map((row) => row.latest_call?.id)).toEqual(['new', 'other']);
  });

  it('keeps messaging available when the call schema is unavailable', async () => {
    const source = [{ id: 'conversation-1' }];
    const client = callActivityClient({ error: { code: '42P01' } });

    await expect(attachLatestCallActivity(source, client)).resolves.toBe(source);
  });
});
