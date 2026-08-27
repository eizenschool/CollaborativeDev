import { describe, expect, it, vi } from 'vitest';
import {
  assertVoiceCallAvailable,
  buildIceServers,
  CALL_MAX_DURATION_MS,
  CALL_STATUS,
  callDurationSeconds,
  callHistoryLabel,
  createCallService,
  incomingCallIdFromUrl,
  isTerminalCallStatus,
  mapCallRow,
  relayNotice,
  remainingCallDurationMs,
} from '../CallService.js';

const userId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const callId = '10000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000001';

function rawCall(overrides = {}) {
  return {
    id: callId,
    conversation_id: conversationId,
    caller_id: userId,
    callee_id: otherId,
    status: 'ringing',
    answer_device_id: null,
    created_at: '2026-08-24T00:00:00Z',
    caller: { id: userId, full_name: 'Aina', profile_photo_url: null },
    callee: { id: otherId, full_name: 'Daniel', profile_photo_url: '/daniel.jpg' },
    ...overrides,
  };
}

describe('voice-call configuration', () => {
  it('accepts only a valid incoming-call id from notification navigation', () => {
    expect(incomingCallIdFromUrl(`/message/${conversationId}?incomingCall=${callId}`)).toBe(callId);
    expect(incomingCallIdFromUrl(`/message/${conversationId}?incomingCall=not-a-call`)).toBeNull();
    expect(incomingCallIdFromUrl('::::')).toBeNull();
  });

  it('provides browser-safe STUN by default and accepts server-issued TURN relays', () => {
    expect(buildIceServers({})).toEqual([{
      urls: ['stun:stun.cloudflare.com:3478'],
    }]);
    expect(buildIceServers({}, [
      { urls: ['stun:one.example', 'stun:two.example'] },
      {
        urls: ['turn:relay.example:3478', 'turns:relay.example:5349'],
        username: 'short-lived-user',
        credential: 'short-lived-password',
      },
    ])).toEqual([
      { urls: ['stun:one.example', 'stun:two.example'] },
      {
        urls: ['turn:relay.example:3478', 'turns:relay.example:5349'],
        username: 'short-lived-user',
        credential: 'short-lived-password',
      },
    ]);
  });

  it('calculates the remaining 60-minute limit and explains relay fallback', () => {
    const now = Date.parse('2026-08-24T02:00:00Z');
    expect(remainingCallDurationMs('2026-08-24T01:30:00Z', now)).toBe(30 * 60 * 1000);
    expect(remainingCallDurationMs('2026-08-24T00:30:00Z', now)).toBe(0);
    expect(remainingCallDurationMs('2026-08-24T02:00:05Z', now)).toBe(CALL_MAX_DURATION_MS);
    expect(remainingCallDurationMs(null, now)).toBe(CALL_MAX_DURATION_MS);
    expect(relayNotice('monthly_limit')).toContain('monthly call relay allowance');
    expect(relayNotice('available')).toBe('');
  });

  it('allows archived private chats and rejects groups or blocked interaction', () => {
    const direct = {
      id: conversationId,
      type: 'direct',
      isReadOnly: false,
      members: [{ id: userId }, { id: otherId }],
    };
    expect(assertVoiceCallAvailable(direct, true)).toBe(true);
    expect(() => assertVoiceCallAvailable({ ...direct, type: 'group' }, true)).toThrow('private chats only');
    expect(assertVoiceCallAvailable({ ...direct, isArchived: true }, true)).toBe(true);
    expect(() => assertVoiceCallAvailable({ ...direct, interactionBlocked: true }, true)).toThrow('unavailable');
    expect(() => assertVoiceCallAvailable(direct, false)).toThrow('not supported');
  });

  it('maps direction and the remote participant without exposing database names', () => {
    expect(mapCallRow(rawCall(), userId)).toMatchObject({
      direction: 'outgoing',
      otherParticipant: { id: otherId, name: 'Daniel', avatarUrl: '/daniel.jpg' },
    });
    expect(mapCallRow(rawCall(), otherId)).toMatchObject({
      direction: 'incoming',
      otherParticipant: { id: userId, name: 'Aina' },
    });
    expect(isTerminalCallStatus(CALL_STATUS.MISSED)).toBe(true);
    expect(isTerminalCallStatus(CALL_STATUS.ACCEPTED)).toBe(false);
  });

  it('maps timeline labels and connected duration', () => {
    expect(callHistoryLabel('missed', 'incoming')).toBe('Missed call');
    expect(callHistoryLabel('declined', 'outgoing')).toBe('Call declined');
    expect(callDurationSeconds('2026-08-24T01:00:00Z', '2026-08-24T01:02:05Z')).toBe(125);
    expect(callDurationSeconds(null, '2026-08-24T01:02:05Z')).toBeNull();
    expect(mapCallRow(rawCall({
      status: 'ended',
      answered_at: '2026-08-24T01:00:00Z',
      ended_at: '2026-08-24T01:02:05Z',
    }), otherId)).toMatchObject({
      itemType: 'call',
      direction: 'incoming',
      label: 'Incoming call',
      durationSeconds: 125,
      sortAt: '2026-08-24T00:00:00Z',
    });
  });
});

describe('CallService repository orchestration', () => {
  it('uses dynamic relay configuration and safely falls back to STUN', async () => {
    const relay = {
      iceServers: [{
        urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'temporary-user',
        credential: 'temporary-secret',
      }],
      relayAvailable: true,
      relayReason: 'available',
      expiresAt: '2026-08-24T03:15:00Z',
    };
    const repository = {
      backend: 'test',
      getTurnIceConfiguration: vi.fn()
        .mockResolvedValueOnce(relay)
        .mockResolvedValueOnce({
          iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
          relayAvailable: true,
          relayReason: 'available',
        })
        .mockRejectedValueOnce(new Error('offline')),
    };
    const service = createCallService(repository);
    await expect(service.getIceConfiguration(callId, {})).resolves.toMatchObject(relay);
    await expect(service.getIceConfiguration(callId, {})).resolves.toMatchObject({
      relayAvailable: false,
      relayReason: 'relay_unavailable',
    });
    await expect(service.getIceConfiguration(callId, {})).resolves.toEqual({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
      relayAvailable: false,
      relayReason: 'relay_unavailable',
      expiresAt: null,
    });
  });

  it('requests audio only with call-safe processing constraints', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    const service = createCallService({ backend: 'test' });
    await service.requestMicrophone({ getUserMedia });
    expect(getUserMedia).toHaveBeenCalledWith({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it('starts, accepts, and ends calls through narrow repository methods', async () => {
    const repository = {
      backend: 'test',
      getCurrentUserId: vi.fn().mockResolvedValue(userId),
      startCall: vi.fn().mockResolvedValue(rawCall()),
      respondToCall: vi.fn().mockResolvedValue(rawCall({
        status: 'accepted',
        answer_device_id: 'device-1',
      })),
      endCall: vi.fn().mockResolvedValue(callId),
    };
    const service = createCallService(repository);
    await expect(service.startCall(conversationId)).resolves.toMatchObject({
      id: callId,
      direction: 'outgoing',
    });
    await expect(service.respondToCall(callId, true, 'device-1')).resolves.toMatchObject({
      status: 'accepted',
      answerDeviceId: 'device-1',
    });
    await expect(service.endCall(callId, 'ended')).resolves.toBe(callId);
    expect(repository.startCall).toHaveBeenCalledWith(conversationId);
    expect(repository.respondToCall).toHaveBeenCalledWith({
      callId,
      accepted: true,
      answerDeviceId: 'device-1',
    });
  });

  it('lists conversation call history with local direction mapping', async () => {
    const repository = {
      backend: 'test',
      getCurrentUserId: vi.fn().mockResolvedValue(otherId),
      listCalls: vi.fn().mockResolvedValue([rawCall({ status: 'missed' })]),
    };
    const service = createCallService(repository);
    await expect(service.listConversationCalls(conversationId)).resolves.toEqual([
      expect.objectContaining({ itemType: 'call', direction: 'incoming', label: 'Missed call' }),
    ]);
    expect(repository.listCalls).toHaveBeenCalledWith(conversationId);
  });

  it('resyncs pending calls whenever Realtime first subscribes or reconnects', async () => {
    let changeListener;
    let statusListener;
    const unsubscribe = vi.fn();
    const repository = {
      backend: 'test',
      getCurrentUserId: vi.fn().mockResolvedValue(otherId),
      getCall: vi.fn().mockResolvedValue(rawCall()),
      subscribeToCalls: vi.fn((onChange, onStatus) => {
        changeListener = onChange;
        statusListener = onStatus;
        return unsubscribe;
      }),
    };
    const service = createCallService(repository);
    const onCall = vi.fn();
    const onSubscribed = vi.fn();
    const stop = service.subscribeToCalls(onCall, { onSubscribed });

    statusListener('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledOnce();

    changeListener({ eventType: 'INSERT', new: rawCall(), old: {} });
    await vi.waitFor(() => expect(onCall).toHaveBeenCalledWith({
      eventType: 'INSERT',
      call: expect.objectContaining({ id: callId, direction: 'incoming' }),
    }));

    stop();
    statusListener('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
