import { describe, expect, it, vi } from 'vitest';
import { retrieveHelpSections } from '../help.ts';

function keywordClient(rows = []) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null })
  };
  return { rpc: vi.fn(), from: vi.fn(() => chain) };
}

describe('Tumpang Guide verified Help retrieval', () => {
  it('returns pgvector Help when the injected embedding query finds a verified row', async () => {
    const admin = keywordClient();
    admin.rpc.mockResolvedValue({
      data: [{ stable_key: 'privacy', content: 'Verified privacy help', similarity: .91 }],
      error: null
    });
    const embedImpl = vi.fn().mockResolvedValue(Array(768).fill(.01));
    const result = await retrieveHelpSections(admin, 'How is chat saved?', 'en', {
      apiKey: 'test-only', embedImpl
    });
    expect(result.source).toBe('pgvector');
    expect(result.sections[0].stable_key).toBe('privacy');
    expect(embedImpl).toHaveBeenCalledOnce();
  });

  it('falls back to versioned keywords when vectors are unavailable', async () => {
    const admin = keywordClient([{
      stable_key: 'alerts', content: 'Verified alert help',
      keywords: ['ride alert', 'notification'], version: 1
    }]);
    const result = await retrieveHelpSections(admin, 'ride alert notification', 'en');
    expect(result.source).toBe('keyword');
    expect(result.sections[0].stable_key).toBe('alerts');
  });

  it('returns a missing source instead of inventing App guidance', async () => {
    const result = await retrieveHelpSections(keywordClient([]), 'unknown operation', 'en');
    expect(result).toEqual({ sections: [], source: 'missing' });
  });
});
