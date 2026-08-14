import { describe, expect, it, vi } from 'vitest';
import {
  baseVideoMimeType,
  selectVideoRecordingMimeType,
} from '../../presentation/components/messaging/useVideoRecorder.js';

describe('video recorder format selection', () => {
  it('prefers WebM with Opus when the browser supports it', () => {
    const MediaRecorderClass = {
      isTypeSupported: vi.fn((type) => type === 'video/webm;codecs=vp8,opus'),
    };

    expect(selectVideoRecordingMimeType(MediaRecorderClass)).toBe('video/webm;codecs=vp8,opus');
  });

  it('falls back to MP4 and normalizes the stored MIME type', () => {
    const MediaRecorderClass = {
      isTypeSupported: vi.fn((type) => type === 'video/mp4'),
    };

    expect(selectVideoRecordingMimeType(MediaRecorderClass)).toBe('video/mp4');
    expect(baseVideoMimeType('video/mp4;codecs=avc1')).toBe('video/mp4');
  });
});
