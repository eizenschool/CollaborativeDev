import { afterEach, describe, expect, it, vi } from 'vitest';

const adapter = {
  isConfigured: true,
  uploadAvatar: vi.fn(async () => ({ data: 'https://example.com/avatars/u1.jpg', error: null })),
  updatePhotoUrl: vi.fn(async () => ({ error: null })),
  checkAvatarContent: vi.fn(async () => ({ data: { flagged: false, categories: [], reason: 'No issues found.' }, error: null }))
};

vi.mock('../../../data-access/m1-profile/profileSupabaseAdapter.js', () => ({ profileSupabaseAdapter: adapter }));
vi.mock('../../m2-rides/RideService.js', () => ({ RideService: {} }));
vi.mock('../../m2-rides/RideRequestService.js', () => ({ RideRequestService: {} }));

const { ProfileService } = await import('../ProfileService.js');

function fakePhoto({ type = 'image/jpeg', bytes = 'fake-photo-bytes' } = {}) {
  return new File([bytes], 'avatar.jpg', { type });
}

describe('Module 1 avatar upload content check (updateProfilePhoto, Supabase backend)', () => {
  afterEach(() => vi.clearAllMocks());

  it('uploads normally when the content check comes back clean', async () => {
    const url = await ProfileService.updateProfilePhoto('u1', fakePhoto());
    expect(url).toBe('https://example.com/avatars/u1.jpg');
    expect(adapter.checkAvatarContent).toHaveBeenCalledTimes(1);
    expect(adapter.uploadAvatar).toHaveBeenCalledTimes(1);
  });

  it('sends the image as base64 without the data-URL prefix, paired with the file\'s MIME type', async () => {
    await ProfileService.updateProfilePhoto('u1', fakePhoto({ type: 'image/png', bytes: 'hi' }));
    const [base64, mimeType] = adapter.checkAvatarContent.mock.calls[0];
    expect(mimeType).toBe('image/png');
    expect(base64).not.toMatch(/^data:/);
    expect(base64).toBe(Buffer.from('hi').toString('base64'));
  });

  it('rejects the upload when the check flags an identity document, and never uploads it', async () => {
    adapter.checkAvatarContent.mockResolvedValueOnce({
      data: { flagged: true, categories: ['identity_document'], reason: 'Looks like a MyKad.' }, error: null
    });
    await expect(ProfileService.updateProfilePhoto('u1', fakePhoto())).rejects.toThrow(/ID document/i);
    expect(adapter.uploadAvatar).not.toHaveBeenCalled();
  });

  // Regression: an offensive-gesture photo (a raised middle finger) was
  // uploaded and approved live before this category existed on the
  // Edge Function side.
  it('rejects the upload when the check flags an offensive gesture', async () => {
    adapter.checkAvatarContent.mockResolvedValueOnce({
      data: { flagged: true, categories: ['offensive_gesture'], reason: 'Shows a raised middle finger.' }, error: null
    });
    await expect(ProfileService.updateProfilePhoto('u1', fakePhoto())).rejects.toThrow(/offensive or insulting gesture/i);
    expect(adapter.uploadAvatar).not.toHaveBeenCalled();
  });

  it('rejects the upload when the check flags sexual content', async () => {
    adapter.checkAvatarContent.mockResolvedValueOnce({
      data: { flagged: true, categories: ['sexual_content'], reason: 'Explicit content detected.' }, error: null
    });
    await expect(ProfileService.updateProfilePhoto('u1', fakePhoto())).rejects.toThrow(/sexual content/i);
    expect(adapter.uploadAvatar).not.toHaveBeenCalled();
  });

  it('fails open (allows the upload) when the content-check service errors', async () => {
    adapter.checkAvatarContent.mockResolvedValueOnce({ data: null, error: new Error('CHECK_UNAVAILABLE') });
    const url = await ProfileService.updateProfilePhoto('u1', fakePhoto());
    expect(url).toBe('https://example.com/avatars/u1.jpg');
    expect(adapter.uploadAvatar).toHaveBeenCalledTimes(1);
  });

  it('fails open when invoking the check throws outright (e.g. a network failure)', async () => {
    adapter.checkAvatarContent.mockRejectedValueOnce(new Error('network down'));
    const url = await ProfileService.updateProfilePhoto('u1', fakePhoto());
    expect(url).toBe('https://example.com/avatars/u1.jpg');
    expect(adapter.uploadAvatar).toHaveBeenCalledTimes(1);
  });

  it('still enforces the existing size/type checks before ever calling the content check', async () => {
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'avatar.jpg', { type: 'image/jpeg' });
    await expect(ProfileService.updateProfilePhoto('u1', oversized)).rejects.toThrow(/5 MB/);
    expect(adapter.checkAvatarContent).not.toHaveBeenCalled();

    const wrongType = new File(['x'], 'avatar.gif', { type: 'image/gif' });
    await expect(ProfileService.updateProfilePhoto('u1', wrongType)).rejects.toThrow(/JPEG, PNG, or WebP/);
    expect(adapter.checkAvatarContent).not.toHaveBeenCalled();
  });
});
