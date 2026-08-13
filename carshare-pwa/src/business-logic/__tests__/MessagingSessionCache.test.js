import { describe, expect, it, vi } from 'vitest';
import { createMessagingSessionCache } from '../MessagingSessionCache.js';

function draft(overrides = {}) {
  return {
    text: 'Meet at the lobby',
    mediaEntries: [{ token: 'new:photo-1', source: 'new', previewUrl: 'blob:photo-1', file: { name: 'photo.jpg' } }],
    location: { latitude: 3.139, longitude: 101.6869 },
    voiceRecording: null,
    editingMessage: null,
    ...overrides,
  };
}

describe('MessagingSessionCache', () => {
  it('keeps independent complete drafts for each conversation', () => {
    const cache = createMessagingSessionCache();
    cache.setActiveUser('user-1');
    const first = draft();
    const second = draft({ text: 'I am on the way', mediaEntries: [], location: null });

    cache.saveDraft('conversation-1', first);
    cache.saveDraft('conversation-2', second);

    expect(cache.getDraft('conversation-1')).toEqual(first);
    expect(cache.getDraft('conversation-2')).toEqual(second);
  });

  it('releases removed media and clears a draft after send or cancel', () => {
    const releasePreviewUrl = vi.fn();
    const cache = createMessagingSessionCache({ releasePreviewUrl });
    cache.setActiveUser('user-1');
    cache.saveDraft('conversation-1', draft());

    cache.saveDraft('conversation-1', draft({ mediaEntries: [] }));
    expect(releasePreviewUrl).toHaveBeenCalledWith('blob:photo-1');

    cache.clearDraft('conversation-1');
    expect(cache.getDraft('conversation-1')).toBeNull();
  });

  it('clears all drafts when the signed-in user changes or signs out', () => {
    const releasePreviewUrl = vi.fn();
    const cache = createMessagingSessionCache({ releasePreviewUrl });
    cache.setActiveUser('user-1');
    cache.saveDraft('conversation-1', draft());

    cache.setActiveUser('user-2');
    expect(cache.getDraft('conversation-1')).toBeNull();
    expect(releasePreviewUrl).toHaveBeenCalledWith('blob:photo-1');

    cache.saveDraft('conversation-2', draft({ mediaEntries: [] }));
    cache.setActiveUser(null);
    expect(cache.getDraft('conversation-2')).toBeNull();
  });

  it('keeps completed voice drafts and releases their preview URLs when removed', () => {
    const releasePreviewUrl = vi.fn();
    const cache = createMessagingSessionCache({ releasePreviewUrl });
    cache.setActiveUser('user-1');
    const voiceRecording = {
      file: { name: 'voice.webm' },
      durationSeconds: 14,
      previewUrl: 'blob:voice-1',
    };

    cache.saveDraft('conversation-1', draft({
      text: '', mediaEntries: [], location: null, voiceRecording,
    }));
    expect(cache.getDraft('conversation-1').voiceRecording).toEqual(voiceRecording);

    cache.saveDraft('conversation-1', draft({
      text: '', mediaEntries: [], location: null, voiceRecording: null,
    }));
    expect(releasePreviewUrl).toHaveBeenCalledWith('blob:voice-1');
    expect(cache.getDraft('conversation-1')).toBeNull();
  });
});
