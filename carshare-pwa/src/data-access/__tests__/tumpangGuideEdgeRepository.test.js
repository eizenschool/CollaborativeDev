import { describe, expect, it } from 'vitest';
import { parseGuideEdgeResponse } from '../tumpangGuideEdgeRepository.js';

describe('Tumpang Guide Edge response handling', () => {
  it('preserves a controlled actor burst response instead of calling it a provider limit', async () => {
    const body = {
      mode: 'fallback', traceId: 'edge-1', fallbackReason: 'burst_limit',
      source: 'unavailable', retryable: true
    };
    const response = { ok: false, status: 429, json: async () => body };

    await expect(parseGuideEdgeResponse(response)).resolves.toEqual(body);
  });

  it('still throws opaque HTTP failures', async () => {
    const response = { ok: false, status: 502, json: async () => ({ message: 'bad gateway' }) };

    await expect(parseGuideEdgeResponse(response)).rejects.toMatchObject({ status: 502 });
  });

  it('preserves auth reason, trace and deployed Edge version for diagnosis', async () => {
    const response = {
      ok: false, status: 401,
      headers: { get: () => 'm6-guide-edge-test' },
      json: async () => ({ reason: 'auth_session_invalid', traceId: 'edge-auth-1' })
    };

    await expect(parseGuideEdgeResponse(response)).rejects.toMatchObject({
      status: 401, fallbackReason: 'auth_session_invalid', traceId: 'edge-auth-1',
      edgeVersion: 'm6-guide-edge-test'
    });
  });
});
