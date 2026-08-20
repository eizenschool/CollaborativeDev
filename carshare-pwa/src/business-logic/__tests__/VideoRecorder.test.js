import { describe, expect, it, vi } from 'vitest';
import {
  baseVideoMimeType,
  selectVideoRecordingMimeType,
  videoCameraConstraints,
} from '../../presentation/components/messaging/useVideoRecorder.js';

describe('video recorder format selection', () => {
  it('prefers H.264 MP4 when the browser supports it', () => {
    const MediaRecorderClass = {
      isTypeSupported: vi.fn((type) => type === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'),
    };

    expect(selectVideoRecordingMimeType(MediaRecorderClass)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });

  it('falls back to WebM and normalizes the stored MIME type', () => {
    const MediaRecorderClass = {
      isTypeSupported: vi.fn((type) => type === 'video/webm'),
    };

    expect(selectVideoRecordingMimeType(MediaRecorderClass)).toBe('video/webm');
    expect(baseVideoMimeType('video/mp4;codecs=avc1')).toBe('video/mp4');
  });

  it('requests the front camera for a selfie video', () => {
    expect(videoCameraConstraints('user')).toMatchObject({
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
    expect(videoCameraConstraints()).toMatchObject({ facingMode: { ideal: 'environment' } });
  });
});
