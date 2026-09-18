import { describe, expect, it } from 'vitest';
import {
  evaluateTurnGuard,
  normalizeCloudflareIceServers,
  stunOnlyConfiguration,
  TURN_CUTOFF_BYTES,
  TURN_CREDENTIAL_TTL_SECONDS,
  TURN_RATE_LIMIT_PER_HOUR,
  utcMonthStart,
} from '../../_shared/m3Turn.ts';

const now = new Date('2026-08-24T02:00:00Z');

function guard(overrides = {}) {
  return {
    period_start: '2026-08-01',
    egress_bytes: 899_900_000_000,
    cutoff_bytes: TURN_CUTOFF_BYTES,
    automatic_blocked: false,
    manual_blocked: false,
    last_checked_at: '2026-08-24T01:55:00Z',
    ...overrides,
  };
}

describe('M3 TURN policy', () => {
  it('uses the chosen production limits', () => {
    expect(TURN_CUTOFF_BYTES).toBe(900_000_000_000);
    expect(TURN_CREDENTIAL_TTL_SECONDS).toBe(75 * 60);
    expect(TURN_RATE_LIMIT_PER_HOUR).toBe(10);
    expect(utcMonthStart(now)).toBe('2026-08-01');
  });

  it('allows 899.9 GB and blocks at exactly 900 GB', () => {
    expect(evaluateTurnGuard(guard(), now)).toEqual({ relayAllowed: true, reason: 'available' });
    expect(evaluateTurnGuard(guard({ egress_bytes: 900_000_000_000 }), now))
      .toEqual({ relayAllowed: false, reason: 'monthly_limit' });
  });

  it('fails closed for manual blocking, a missing check, or stale monitoring', () => {
    expect(evaluateTurnGuard(guard({ manual_blocked: true }), now).reason).toBe('manual_block');
    expect(evaluateTurnGuard(guard({ last_checked_at: null }), now).reason).toBe('monitor_uninitialized');
    expect(evaluateTurnGuard(guard({ last_checked_at: '2026-08-24T01:44:59Z' }), now).reason)
      .toBe('monitor_stale');
  });

  it('sanitizes Cloudflare ICE payloads and removes browser-blocked port 53', () => {
    expect(normalizeCloudflareIceServers([
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-credential',
      },
      { urls: ['turn:bad.example:3478'] },
    ])).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-credential',
      },
    ]);
  });

  it('returns STUN-only configuration when relay use is stopped', () => {
    expect(stunOnlyConfiguration('monthly_limit')).toEqual({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
      relayAvailable: false,
      relayReason: 'monthly_limit',
      expiresAt: null,
    });
  });
});
