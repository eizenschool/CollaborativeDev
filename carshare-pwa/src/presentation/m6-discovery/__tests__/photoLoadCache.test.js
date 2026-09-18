import { beforeEach, describe, expect, it } from 'vitest';
import {
  __clearPhotoStatusCache, getCachedPhotoStatus, setCachedPhotoStatus
} from '../components/discover/photoLoadCache.js';

describe('photoLoadCache', () => {
  beforeEach(() => __clearPhotoStatusCache());

  it('returns undefined for a url never recorded', () => {
    expect(getCachedPhotoStatus('https://example.com/a.jpg')).toBeUndefined();
  });

  it('remembers a url recorded as loaded', () => {
    setCachedPhotoStatus('https://example.com/a.jpg', 'loaded');
    expect(getCachedPhotoStatus('https://example.com/a.jpg')).toBe('loaded');
  });

  it('remembers a url recorded as failed', () => {
    setCachedPhotoStatus('https://example.com/a.jpg', 'failed');
    expect(getCachedPhotoStatus('https://example.com/a.jpg')).toBe('failed');
  });

  it('clears cached status between test cases via __clearPhotoStatusCache', () => {
    setCachedPhotoStatus('https://example.com/a.jpg', 'loaded');
    __clearPhotoStatusCache();
    expect(getCachedPhotoStatus('https://example.com/a.jpg')).toBeUndefined();
  });

  it('ignores null/undefined urls without throwing', () => {
    expect(() => setCachedPhotoStatus(null, 'loaded')).not.toThrow();
    expect(() => setCachedPhotoStatus(undefined, 'failed')).not.toThrow();
    expect(getCachedPhotoStatus(null)).toBeUndefined();
    expect(getCachedPhotoStatus(undefined)).toBeUndefined();
  });
});
