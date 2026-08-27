import { supabaseCallRepository } from '../data-access/supabaseCallRepository.js';

export const CALL_STATUS = Object.freeze({
  RINGING: 'ringing',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  ENDED: 'ended',
  MISSED: 'missed',
  FAILED: 'failed',
});

export const CALL_RING_TIMEOUT_MS = 45_000;
export const CALL_MAX_DURATION_MS = 60 * 60 * 1000;
const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function incomingCallIdFromUrl(value, baseUrl = 'http://localhost') {
  try {
    const callId = new URL(value, baseUrl).searchParams.get('incomingCall');
    return CALL_ID_PATTERN.test(callId || '') ? callId : null;
  } catch {
    return null;
  }
}

const DEFAULT_STUN_URL = 'stun:stun.cloudflare.com:3478';
const TERMINAL_STATUSES = new Set([
  CALL_STATUS.DECLINED,
  CALL_STATUS.CANCELLED,
  CALL_STATUS.ENDED,
  CALL_STATUS.MISSED,
  CALL_STATUS.FAILED,
]);

function csv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIceServers(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((server) => {
    if (!server || typeof server !== 'object') return [];
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter((url) => typeof url === 'string' && /^(stun|turn|turns):/i.test(url));
    if (!urls.length) return [];
    const hasTurn = urls.some((url) => /^turns?:/i.test(url));
    if (hasTurn && (!server.username || !server.credential)) return [];
    return [{
      urls,
      ...(hasTurn ? { username: server.username, credential: server.credential } : {}),
    }];
  });
}

function hasTurnServer(iceServers) {
  return iceServers.some((server) => server.urls.some((url) => /^turns?:/i.test(url)));
}

export function buildIceServers(environment = {}, dynamicServers = []) {
  const normalizedDynamicServers = normalizeIceServers(dynamicServers);
  if (normalizedDynamicServers.length) return normalizedDynamicServers;
  const stunUrls = csv(environment.VITE_WEBRTC_STUN_URLS);
  return [{ urls: stunUrls.length ? stunUrls : [DEFAULT_STUN_URL] }];
}

export function remainingCallDurationMs(answeredAt, now = Date.now()) {
  const answeredAtMs = new Date(answeredAt || '').getTime();
  if (!Number.isFinite(answeredAtMs)) return CALL_MAX_DURATION_MS;
  return Math.min(CALL_MAX_DURATION_MS, Math.max(0, CALL_MAX_DURATION_MS - (now - answeredAtMs)));
}

export function relayNotice(reason) {
  if (reason === 'monthly_limit' || reason === 'manual_block') {
    return 'The monthly call relay allowance is unavailable. Direct calls may still work on some networks.';
  }
  if (reason === 'monitor_stale' || reason === 'monitor_uninitialized') {
    return 'The call relay safety monitor is unavailable. This call will try a direct connection.';
  }
  if (reason && reason !== 'available') {
    return 'The call relay is unavailable. This call will try a direct connection.';
  }
  return '';
}

export function isTerminalCallStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function mapProfile(profile) {
  if (!profile) return { id: null, name: 'Member', avatarUrl: null };
  return {
    id: profile.id,
    name: profile.full_name || 'Member',
    avatarUrl: profile.profile_photo_url || null,
  };
}

export function callHistoryLabel(status, direction) {
  const incoming = direction === 'incoming';
  return {
    ringing: incoming ? 'Incoming call' : 'Outgoing call',
    accepted: 'Ongoing call',
    declined: incoming ? 'Declined call' : 'Call declined',
    cancelled: incoming ? 'Cancelled incoming call' : 'Cancelled call',
    ended: incoming ? 'Incoming call' : 'Outgoing call',
    missed: incoming ? 'Missed call' : 'No answer',
    failed: 'Call failed',
  }[status] || 'Voice call';
}

export function callDurationSeconds(answeredAt, endedAt) {
  const start = new Date(answeredAt || '').getTime();
  const end = new Date(endedAt || '').getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function mapCallRow(row, currentUserId) {
  if (!row) return null;
  const isCaller = row.caller_id === currentUserId;
  const direction = isCaller ? 'outgoing' : 'incoming';
  return {
    itemType: 'call',
    id: row.id,
    conversationId: row.conversation_id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    direction,
    status: row.status,
    label: callHistoryLabel(row.status, direction),
    answerDeviceId: row.answer_device_id || null,
    createdAt: row.created_at,
    answeredAt: row.answered_at || null,
    endedAt: row.ended_at || null,
    durationSeconds: callDurationSeconds(row.answered_at, row.ended_at),
    sortAt: row.created_at,
    caller: mapProfile(row.caller),
    callee: mapProfile(row.callee),
    otherParticipant: mapProfile(isCaller ? row.callee : row.caller),
  };
}

export function assertVoiceCallAvailable(conversation, supported = true) {
  if (!supported) throw new Error('Voice calls are not supported by this browser.');
  if (!conversation?.id) throw new Error('Open a private conversation before calling.');
  if (conversation.type !== 'direct') {
    throw new Error('Voice calls are currently available in private chats only.');
  }
  if (conversation.isReadOnly || conversation.isArchived) {
    throw new Error('Archived conversations cannot start voice calls.');
  }
  const activeMembers = conversation.members?.filter((member) => !member.leftAt) || [];
  if (activeMembers.length !== 2) throw new Error('This private chat is unavailable for calling.');
  return true;
}

function browserSupportsCalls() {
  return typeof globalThis.RTCPeerConnection === 'function'
    && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);
}

export function createCallService(repository = supabaseCallRepository) {
  return {
    backend: repository.backend,

    isSupported: browserSupportsCalls,

    getFallbackIceServers(environment = import.meta.env) {
      return buildIceServers(environment);
    },

    async getIceConfiguration(callId, environment = import.meta.env) {
      const fallback = {
        iceServers: buildIceServers(environment),
        relayAvailable: false,
        relayReason: 'relay_unavailable',
        expiresAt: null,
      };
      if (typeof repository.getTurnIceConfiguration !== 'function') return fallback;
      try {
        const configuration = await repository.getTurnIceConfiguration(callId);
        const iceServers = buildIceServers(environment, configuration?.iceServers);
        const relayAvailable = configuration?.relayAvailable === true && hasTurnServer(iceServers);
        return {
          iceServers,
          relayAvailable,
          relayReason: relayAvailable
            ? (configuration?.relayReason || 'available')
            : (configuration?.relayReason && configuration.relayReason !== 'available'
              ? configuration.relayReason
              : 'relay_unavailable'),
          expiresAt: configuration?.expiresAt || null,
        };
      } catch {
        return fallback;
      }
    },

    assertAvailable(conversation) {
      return assertVoiceCallAvailable(conversation, this.isSupported());
    },

    async requestMicrophone(mediaDevices = globalThis.navigator?.mediaDevices) {
      if (!mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot access a microphone for calls.');
      }
      try {
        return await mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
          throw new Error('Microphone permission is required to make a voice call.');
        }
        if (error?.name === 'NotFoundError') {
          throw new Error('No microphone was found on this device.');
        }
        throw new Error(error?.message || 'Unable to open the microphone.');
      }
    },

    async getCall(callId) {
      const [userId, row] = await Promise.all([
        repository.getCurrentUserId(),
        repository.getCall(callId),
      ]);
      return mapCallRow(row, userId);
    },

    async listConversationCalls(conversationId) {
      if (!conversationId) throw new Error('A conversation is required to load call history.');
      const [userId, rows] = await Promise.all([
        repository.getCurrentUserId(),
        repository.listCalls(conversationId),
      ]);
      return rows.map((row) => mapCallRow(row, userId));
    },

    async getPendingIncomingCall() {
      const [userId, row] = await Promise.all([
        repository.getCurrentUserId(),
        repository.getPendingIncomingCall(),
      ]);
      return mapCallRow(row, userId);
    },

    async startCall(conversationId) {
      const userId = await repository.getCurrentUserId();
      return mapCallRow(await repository.startCall(conversationId), userId);
    },

    async respondToCall(callId, accepted, answerDeviceId) {
      const userId = await repository.getCurrentUserId();
      const call = mapCallRow(await repository.respondToCall({
        callId,
        accepted,
        answerDeviceId,
      }), userId);
      if (accepted && call.status !== CALL_STATUS.ACCEPTED) {
        throw new Error('This call is no longer ringing.');
      }
      return call;
    },

    endCall(callId, outcome) {
      if (!['cancelled', 'ended', 'missed', 'failed'].includes(outcome)) {
        throw new Error('Unsupported call outcome.');
      }
      return repository.endCall({ callId, outcome });
    },

    openSignalChannel(callId, listener) {
      return repository.openSignalChannel(callId, listener);
    },

    subscribeToCalls(listener, { onSubscribed, onError } = {}) {
      let active = true;
      const unsubscribe = repository.subscribeToCalls((change) => {
        const row = change?.new && Object.keys(change.new).length ? change.new : change?.old;
        if (!row?.id) return;
        this.getCall(row.id)
          .then((call) => {
            if (active && call) listener({ eventType: change.eventType, call });
          })
          .catch(() => {});
      }, (status, error) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') onSubscribed?.();
        if (error && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          onError?.(error);
        }
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}

export const CallService = createCallService();
