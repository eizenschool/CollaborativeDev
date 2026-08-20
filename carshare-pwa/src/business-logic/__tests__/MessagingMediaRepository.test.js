import { describe, expect, it, vi } from 'vitest';
import { attachSignedUrls } from '../../data-access/supabaseMessagingRepository.js';

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
