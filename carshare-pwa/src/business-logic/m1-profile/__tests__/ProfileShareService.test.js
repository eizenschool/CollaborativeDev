import { describe, expect, it, vi } from 'vitest';
import { buildPublicProfileUrl, sharePublicProfile } from '../ProfileShareService.js';

describe('public profile sharing', () => {
  it('builds a stable public profile link', () => {
    expect(buildPublicProfileUrl('user/id', 'https://tumpang.test/')).toBe('https://tumpang.test/users/user%2Fid');
  });

  it('prefers the system share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await sharePublicProfile({
      userId: 'user-1',
      displayName: 'Jamie',
      origin: 'https://tumpang.test',
      navigatorObject: { share, clipboard: { writeText: vi.fn() } },
    });
    expect(result).toEqual({ method: 'shared', url: 'https://tumpang.test/users/user-1' });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: result.url }));
  });

  it('copies the link when native sharing is unavailable or fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await sharePublicProfile({
      userId: 'user-1',
      origin: 'https://tumpang.test',
      navigatorObject: { share: vi.fn().mockRejectedValue(new Error('unavailable')), clipboard: { writeText } },
    });
    expect(result.method).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(result.url);
  });

  it('does not copy after the user cancels the native share sheet', async () => {
    const writeText = vi.fn();
    const result = await sharePublicProfile({
      userId: 'user-1',
      origin: 'https://tumpang.test',
      navigatorObject: {
        share: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
        clipboard: { writeText },
      },
    });
    expect(result.method).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
});
