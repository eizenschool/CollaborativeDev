import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CALL_RING_TIMEOUT_MS,
  CALL_STATUS,
  CallService,
  incomingCallIdFromUrl,
  isCurrentCallParticipantAccepted,
  isTerminalCallStatus,
  relayNotice,
  remainingCallDurationMs,
} from '../business-logic/CallService.js';
import {
  advanceVoiceActivity,
  rmsFromTimeDomain,
} from '../business-logic/CallVoiceActivity.js';
import { useAuth } from './AuthContext.jsx';
import { useNotifications } from './NotificationContext.jsx';

const CallSessionContext = createContext(null);
const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_HEARTBEAT_INTERVAL_MS = 15_000;
const VOICE_ACTIVITY_INTERVAL_MS = 80;

function clearIncomingCallFromUrl() {
  if (!globalThis.location?.href || !globalThis.history?.replaceState) return;
  const url = new URL(globalThis.location.href);
  if (!url.searchParams.has('incomingCall')) return;
  url.searchParams.delete('incomingCall');
  globalThis.history.replaceState(
    globalThis.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

const EMPTY_STATE = Object.freeze({
  phase: 'idle',
  call: null,
  isMuted: false,
  isPending: false,
  remoteStream: null,
  remoteStreams: [],
  connectedAt: null,
  endedReason: '',
  error: '',
  relayNotice: '',
  isMinimized: false,
  speakingUserIds: [],
});

function createDeviceId() {
  const key = 'm3-call-device-id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  }
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function terminalMessage(reason) {
  return {
    declined: 'Call declined',
    cancelled: 'Call cancelled',
    ended: 'Call ended',
    missed: 'No answer',
    failed: 'Call connection failed',
    'answered-elsewhere': 'Call answered on another device',
    'duration-limit': 'Call ended after 60 minutes',
  }[reason] || 'Call ended';
}

function createActiveCall(call, role) {
  return {
    call,
    role,
    localStream: null,
    remoteStream: null,
    remoteStreams: new Map(),
    peers: new Map(),
    signalChannel: null,
    pendingCandidates: new Map(),
    ringTimerId: null,
    disconnectTimerIds: new Map(),
    maxDurationTimerId: null,
    heartbeatTimerId: null,
    heartbeatCleanup: null,
    iceServers: null,
    offerStarted: new Set(),
    finishing: false,
    voiceActivityContext: null,
    voiceActivityEntries: new Map(),
    voiceActivityTimerId: null,
    voiceActivityUnavailable: false,
    speakingKey: '',
  };
}

function releaseResources(active) {
  if (!active) return;
  if (active.ringTimerId) globalThis.clearTimeout(active.ringTimerId);
  active.disconnectTimerIds?.forEach((timerId) => globalThis.clearTimeout(timerId));
  if (active.maxDurationTimerId) globalThis.clearTimeout(active.maxDurationTimerId);
  if (active.heartbeatTimerId) globalThis.clearInterval(active.heartbeatTimerId);
  if (active.voiceActivityTimerId) globalThis.clearInterval(active.voiceActivityTimerId);
  active.heartbeatCleanup?.();
  active.voiceActivityEntries?.forEach((entry) => {
    entry.source?.disconnect?.();
    entry.analyser?.disconnect?.();
  });
  active.voiceActivityEntries?.clear?.();
  void active.voiceActivityContext?.close?.().catch?.(() => {});
  stopStream(active.localStream);
  active.remoteStreams?.forEach((stream) => stopStream(stream));
  active.peers?.forEach((peer) => {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
  });
  void active.signalChannel?.unsubscribe?.();
}

export function CallSessionProvider({ children }) {
  const { user } = useAuth();
  const { startCallRingtone, stopCallRingtone } = useNotifications();
  const userId = user?.id || null;
  const deviceIdRef = useRef(null);
  if (!deviceIdRef.current) deviceIdRef.current = createDeviceId();
  const activeRef = useRef(null);
  const stateRef = useRef(EMPTY_STATE);
  const terminalTimerRef = useRef(null);
  const finishCallRef = useRef(null);
  const handleSignalRef = useRef(null);
  const presentIncomingRef = useRef(null);
  const [state, setState] = useState(EMPTY_STATE);

  const updateState = useCallback((nextValue) => {
    setState((current) => {
      const next = typeof nextValue === 'function' ? nextValue(current) : nextValue;
      stateRef.current = next;
      return next;
    });
  }, []);

  const clearTerminalTimer = useCallback(() => {
    if (terminalTimerRef.current) globalThis.clearTimeout(terminalTimerRef.current);
    terminalTimerRef.current = null;
  }, []);

  const dismissEndedCall = useCallback(() => {
    if (activeRef.current) return;
    clearTerminalTimer();
    updateState(EMPTY_STATE);
  }, [clearTerminalTimer, updateState]);

  const showTerminalState = useCallback((call, reason, error = '') => {
    clearTerminalTimer();
    updateState({
      ...EMPTY_STATE,
      phase: 'ended',
      call,
      endedReason: terminalMessage(reason),
      error,
    });
    terminalTimerRef.current = globalThis.setTimeout(() => {
      terminalTimerRef.current = null;
      if (!activeRef.current) updateState(EMPTY_STATE);
    }, 3_000);
  }, [clearTerminalTimer, updateState]);

  const sendSignal = useCallback(async (type, data = {}) => {
    const active = activeRef.current;
    if (!active?.signalChannel || !userId) return;
    await active.signalChannel.send({
      callId: active.call.id,
      type,
      fromUserId: userId,
      deviceId: deviceIdRef.current,
      ...data,
    });
  }, [userId]);

  const finishCall = useCallback(async (reason, options = {}) => {
    const active = activeRef.current;
    if (!active || active.finishing) return;
    active.finishing = true;
    const call = active.call;
    const {
      broadcast = false,
      persist = false,
      persistOutcome = reason,
      error = '',
    } = options;

    globalThis.navigator?.vibrate?.(0);
    if (broadcast && active.signalChannel) {
      await sendSignal('participant-left', { reason }).catch(() => {});
    }
    if (persist) {
      await CallService.endCall(call.id, persistOutcome).catch(() => {});
    }
    releaseResources(active);
    if (activeRef.current === active) activeRef.current = null;
    showTerminalState(call, reason, error);
  }, [sendSignal, showTerminalState]);
  finishCallRef.current = finishCall;

  const scheduleRingTimeout = useCallback((active) => {
    const elapsed = Date.now() - new Date(active.call.createdAt).getTime();
    const remaining = Math.max(0, CALL_RING_TIMEOUT_MS - elapsed);
    active.ringTimerId = globalThis.setTimeout(() => {
      finishCallRef.current?.('missed', { persist: true, broadcast: true });
    }, remaining);
  }, []);

  const scheduleCallLimit = useCallback((active) => {
    if (active.maxDurationTimerId) globalThis.clearTimeout(active.maxDurationTimerId);
    active.maxDurationTimerId = globalThis.setTimeout(() => {
      void finishCallRef.current?.('duration-limit', {
        persist: true,
        persistOutcome: 'ended',
        broadcast: true,
      });
    }, remainingCallDurationMs(active.call.answeredAt));
  }, []);

  const startHeartbeat = useCallback((active) => {
    if (active.heartbeatTimerId) globalThis.clearInterval(active.heartbeatTimerId);
    active.heartbeatCleanup?.();
    const heartbeat = () => {
      if (activeRef.current !== active || active.finishing) return;
      void CallService.heartbeatCall(active.call.id, deviceIdRef.current).catch(() => {});
    };
    const heartbeatWhenActive = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') heartbeat();
    };
    heartbeat();
    active.heartbeatTimerId = globalThis.setInterval(heartbeat, CALL_HEARTBEAT_INTERVAL_MS);
    globalThis.addEventListener?.('online', heartbeatWhenActive);
    globalThis.addEventListener?.('focus', heartbeatWhenActive);
    globalThis.addEventListener?.('pageshow', heartbeatWhenActive);
    globalThis.document?.addEventListener?.('visibilitychange', heartbeatWhenActive);
    active.heartbeatCleanup = () => {
      globalThis.removeEventListener?.('online', heartbeatWhenActive);
      globalThis.removeEventListener?.('focus', heartbeatWhenActive);
      globalThis.removeEventListener?.('pageshow', heartbeatWhenActive);
      globalThis.document?.removeEventListener?.('visibilitychange', heartbeatWhenActive);
      active.heartbeatCleanup = null;
    };
  }, []);

  const loadIceConfiguration = useCallback(async (active) => {
    const configuration = await CallService.getIceConfiguration(active.call.id);
    active.iceServers = configuration.iceServers;
    const notice = relayNotice(configuration.relayReason);
    if (activeRef.current === active && !active.finishing) {
      updateState((current) => ({ ...current, relayNotice: notice }));
    }
    return configuration;
  }, [updateState]);

  const publishSpeakingUsers = useCallback((active) => {
    if (activeRef.current !== active || active.finishing) return;
    const speakingUserIds = [...active.voiceActivityEntries.entries()]
      .filter(([, entry]) => entry.activity.speaking)
      .map(([entryUserId]) => entryUserId)
      .sort();
    const speakingKey = speakingUserIds.join('|');
    if (speakingKey === active.speakingKey) return;
    active.speakingKey = speakingKey;
    updateState((current) => ({ ...current, speakingUserIds }));
  }, [updateState]);

  const syncVoiceActivity = useCallback((active) => {
    if (!active || active.finishing || active.voiceActivityUnavailable) return;
    const streams = new Map(active.remoteStreams);
    if (active.localStream && userId) streams.set(userId, active.localStream);

    active.voiceActivityEntries.forEach((entry, entryUserId) => {
      if (streams.get(entryUserId) === entry.stream) return;
      entry.source?.disconnect?.();
      entry.analyser?.disconnect?.();
      active.voiceActivityEntries.delete(entryUserId);
    });

    try {
      const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextConstructor) {
        active.voiceActivityUnavailable = true;
        return;
      }
      if (!active.voiceActivityContext) active.voiceActivityContext = new AudioContextConstructor();
      void active.voiceActivityContext.resume?.().catch(() => {});

      streams.forEach((stream, streamUserId) => {
        if (active.voiceActivityEntries.has(streamUserId) || !stream?.getAudioTracks?.().length) return;
        const source = active.voiceActivityContext.createMediaStreamSource(stream);
        const analyser = active.voiceActivityContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);
        active.voiceActivityEntries.set(streamUserId, {
          stream,
          source,
          analyser,
          samples: new Float32Array(analyser.fftSize),
          byteSamples: new Uint8Array(analyser.fftSize),
          activity: { speaking: false, loudSamples: 0, quietSamples: 0 },
        });
      });

      if (!active.voiceActivityTimerId && active.voiceActivityEntries.size) {
        active.voiceActivityTimerId = globalThis.setInterval(() => {
          if (activeRef.current !== active || active.finishing) return;
          active.voiceActivityEntries.forEach((entry) => {
            const enabled = entry.stream.getAudioTracks().some(
              (track) => track.enabled && track.readyState !== 'ended',
            );
            let level = 0;
            if (enabled && typeof entry.analyser.getFloatTimeDomainData === 'function') {
              entry.analyser.getFloatTimeDomainData(entry.samples);
              level = rmsFromTimeDomain(entry.samples);
            } else if (enabled) {
              entry.analyser.getByteTimeDomainData(entry.byteSamples);
              for (let index = 0; index < entry.byteSamples.length; index += 1) {
                entry.samples[index] = (entry.byteSamples[index] - 128) / 128;
              }
              level = rmsFromTimeDomain(entry.samples);
            }
            entry.activity = advanceVoiceActivity(entry.activity, level);
          });
          publishSpeakingUsers(active);
        }, VOICE_ACTIVITY_INTERVAL_MS);
      }
      publishSpeakingUsers(active);
    } catch {
      if (active.voiceActivityTimerId) globalThis.clearInterval(active.voiceActivityTimerId);
      active.voiceActivityTimerId = null;
      active.voiceActivityEntries.forEach((entry) => {
        entry.source?.disconnect?.();
        entry.analyser?.disconnect?.();
      });
      active.voiceActivityEntries.clear();
      void active.voiceActivityContext?.close?.().catch?.(() => {});
      active.voiceActivityContext = null;
      active.voiceActivityUnavailable = true;
      publishSpeakingUsers(active);
    }
  }, [publishSpeakingUsers, userId]);

  const publishRemoteStreams = useCallback((active) => {
    const remoteStreams = [...active.remoteStreams.entries()].map(([remoteUserId, stream]) => ({
      userId: remoteUserId,
      stream,
    }));
    active.remoteStream = remoteStreams[0]?.stream || null;
    updateState((current) => ({
      ...current,
      remoteStream: active.remoteStream,
      remoteStreams,
    }));
    syncVoiceActivity(active);
  }, [syncVoiceActivity, updateState]);

  const removePeer = useCallback((active, remoteUserId) => {
    const timerId = active.disconnectTimerIds.get(remoteUserId);
    if (timerId) globalThis.clearTimeout(timerId);
    active.disconnectTimerIds.delete(remoteUserId);
    const peer = active.peers.get(remoteUserId);
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    active.peers.delete(remoteUserId);
    active.offerStarted.delete(remoteUserId);
    active.pendingCandidates.delete(remoteUserId);
    const stream = active.remoteStreams.get(remoteUserId);
    if (stream) stopStream(stream);
    active.remoteStreams.delete(remoteUserId);
    publishRemoteStreams(active);
  }, [publishRemoteStreams]);

  const flushCandidates = useCallback(async (active, remoteUserId) => {
    const peer = active.peers.get(remoteUserId);
    if (!peer?.remoteDescription) return;
    const candidates = active.pendingCandidates.get(remoteUserId) || [];
    active.pendingCandidates.set(remoteUserId, []);
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  const ensurePeer = useCallback((active, remoteUserId) => {
    if (!remoteUserId || remoteUserId === userId) throw new Error('A remote call member is required.');
    if (active.peers.has(remoteUserId)) return active.peers.get(remoteUserId);
    if (!active.localStream) throw new Error('The microphone is not ready.');
    const peer = new RTCPeerConnection({
      iceServers: active.iceServers || CallService.getFallbackIceServers(),
    });
    active.peers.set(remoteUserId, peer);
    active.pendingCandidates.set(remoteUserId, []);
    active.localStream.getTracks().forEach((track) => peer.addTrack(track, active.localStream));

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendSignal('ice-candidate', {
        targetUserId: remoteUserId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
      }).catch(() => {});
    };

    peer.ontrack = (event) => {
      if (activeRef.current !== active) return;
      const remoteStream = event.streams?.[0]
        || active.remoteStreams.get(remoteUserId)
        || new MediaStream();
      if (!event.streams?.[0] && !remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track);
      }
      active.remoteStreams.set(remoteUserId, remoteStream);
      publishRemoteStreams(active);
    };

    peer.onconnectionstatechange = () => {
      if (activeRef.current !== active || active.finishing) return;
      if (peer.connectionState === 'connected') {
        const timerId = active.disconnectTimerIds.get(remoteUserId);
        if (timerId) globalThis.clearTimeout(timerId);
        active.disconnectTimerIds.delete(remoteUserId);
        updateState((current) => ({
          ...current,
          phase: 'connected',
          connectedAt: current.connectedAt || Date.now(),
          error: '',
        }));
      } else if (peer.connectionState === 'disconnected') {
        if (![...active.peers.values()].some((item) => item !== peer && item.connectionState === 'connected')) {
          updateState((current) => ({ ...current, phase: 'reconnecting' }));
        }
        const previousTimer = active.disconnectTimerIds.get(remoteUserId);
        if (previousTimer) globalThis.clearTimeout(previousTimer);
        active.disconnectTimerIds.set(remoteUserId, globalThis.setTimeout(() => {
          if (peer.connectionState !== 'disconnected') return;
          removePeer(active, remoteUserId);
          if (!active.call.isGroup) {
            void finishCallRef.current?.('failed', { persist: true, broadcast: true });
          }
        }, 10_000));
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        removePeer(active, remoteUserId);
        if (!active.call.isGroup && peer.connectionState === 'failed') {
          void finishCallRef.current?.('failed', { persist: true, broadcast: true });
        }
      }
    };
    return peer;
  }, [publishRemoteStreams, removePeer, sendSignal, updateState, userId]);

  const createAndSendOffer = useCallback(async (active, remoteUserId) => {
    if (active.offerStarted.has(remoteUserId) || active.finishing) return;
    active.offerStarted.add(remoteUserId);
    try {
      const peer = ensurePeer(active, remoteUserId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal('offer', {
        targetUserId: remoteUserId,
        description: peer.localDescription,
      });
    } catch (error) {
      active.offerStarted.delete(remoteUserId);
      removePeer(active, remoteUserId);
      if (!active.call.isGroup) {
        await finishCallRef.current?.('failed', {
          persist: true,
          broadcast: true,
          error: error.message || 'Unable to connect the call.',
        });
        return;
      }
      updateState((current) => ({
        ...current,
        error: error.message || 'Unable to connect to one group member.',
      }));
    }
  }, [ensurePeer, removePeer, sendSignal, updateState]);

  const greetPeer = useCallback(async (active, remoteUserId) => {
    await sendSignal('peer-present', { targetUserId: remoteUserId });
    if (String(userId).localeCompare(String(remoteUserId)) < 0) {
      await createAndSendOffer(active, remoteUserId);
    }
  }, [createAndSendOffer, sendSignal, userId]);

  const handleSignal = useCallback(async (signal) => {
    const active = activeRef.current;
    if (!active || active.finishing || signal?.callId !== active.call.id) return;
    if (!signal.fromUserId || signal.fromUserId === userId) return;
    if (signal.targetUserId && signal.targetUserId !== userId) return;
    const remoteUserId = signal.fromUserId;

    try {
      if (signal.type === 'peer-ready') {
        if (active.localStream) await greetPeer(active, remoteUserId);
      } else if (signal.type === 'peer-present') {
        if (active.localStream && String(userId).localeCompare(String(remoteUserId)) < 0) {
          await createAndSendOffer(active, remoteUserId);
        }
      } else if (signal.type === 'offer') {
        const peer = ensurePeer(active, remoteUserId);
        if (peer.remoteDescription) return;
        await peer.setRemoteDescription(signal.description);
        await flushCandidates(active, remoteUserId);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await sendSignal('answer', {
          targetUserId: remoteUserId,
          description: peer.localDescription,
        });
      } else if (signal.type === 'answer') {
        const peer = ensurePeer(active, remoteUserId);
        if (peer.remoteDescription) return;
        await peer.setRemoteDescription(signal.description);
        await flushCandidates(active, remoteUserId);
      } else if (signal.type === 'ice-candidate' && signal.candidate) {
        const peer = ensurePeer(active, remoteUserId);
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else active.pendingCandidates.get(remoteUserId)?.push(signal.candidate);
      } else if (signal.type === 'participant-left' || signal.type === 'hangup') {
        removePeer(active, remoteUserId);
        if (!active.call.isGroup) await finishCallRef.current?.(signal.reason || 'ended');
      }
    } catch (error) {
      removePeer(active, remoteUserId);
      if (!active.call.isGroup) {
        await finishCallRef.current?.('failed', {
          persist: true,
          broadcast: true,
          error: error.message || 'Unable to connect the call.',
        });
        return;
      }
      updateState((current) => ({
        ...current,
        error: error.message || 'Unable to connect to one group member.',
      }));
    }
  }, [createAndSendOffer, ensurePeer, flushCandidates, greetPeer, removePeer, sendSignal, updateState, userId]);
  handleSignalRef.current = handleSignal;

  const openSignalChannel = useCallback((callId) => (
    CallService.openSignalChannel(callId, (signal) => {
      void handleSignalRef.current?.(signal);
    })
  ), []);

  const presentIncoming = useCallback((call) => {
    if (!call || call.direction !== 'incoming' || call.status !== CALL_STATUS.RINGING) return;
    if (activeRef.current) return;
    clearTerminalTimer();
    const active = createActiveCall(call, 'callee');
    activeRef.current = active;
    startHeartbeat(active);
    scheduleRingTimeout(active);
    updateState({ ...EMPTY_STATE, phase: 'incoming', call });
    globalThis.navigator?.vibrate?.([250, 150, 250]);
  }, [clearTerminalTimer, scheduleRingTimeout, startHeartbeat, updateState]);
  presentIncomingRef.current = presentIncoming;

  const handleCallChange = useCallback(({ call }) => {
    const active = activeRef.current;
    if (!active) {
      presentIncomingRef.current?.(call);
      return;
    }
    if (active.call.id !== call.id || active.finishing) return;
    active.call = call;
    updateState((current) => ({ ...current, call }));

    const sessionStatus = call.sessionStatus || call.status;
    if (isTerminalCallStatus(sessionStatus)) {
      void finishCallRef.current?.(sessionStatus);
      return;
    }
    const selfStatus = call.selfParticipant?.status || call.status;
    if (['declined', 'missed', 'left', 'failed'].includes(selfStatus)) {
      void finishCallRef.current?.(selfStatus === 'left' ? 'ended' : selfStatus);
      return;
    }

    // A group session becomes accepted as soon as the first invitee answers.
    // Other invitees must remain on their incoming screen until their own
    // participant row is accepted; otherwise their Answer button disappears.
    if (isCurrentCallParticipantAccepted(call)) {
      if (active.ringTimerId) globalThis.clearTimeout(active.ringTimerId);
      active.ringTimerId = null;
      scheduleCallLimit(active);
      if (active.role === 'callee' && call.answerDeviceId
          && call.answerDeviceId !== deviceIdRef.current) {
        void finishCallRef.current?.('answered-elsewhere');
        return;
      }
      const hasConnectedPeer = [...active.peers.values()]
        .some((peer) => peer.connectionState === 'connected');
      updateState((current) => ({
        ...current,
        phase: hasConnectedPeer ? 'connected' : 'connecting',
        isPending: false,
      }));
      if (active.localStream && active.signalChannel) {
        void sendSignal('peer-ready').catch(() => {});
      }
    }
  }, [scheduleCallLimit, sendSignal, updateState]);

  useEffect(() => {
    if (!userId) return undefined;
    let disposed = false;
    let pendingSync = null;
    updateState(EMPTY_STATE);

    const syncPendingIncomingCall = () => {
      if (disposed || activeRef.current) return Promise.resolve(null);
      if (pendingSync) return pendingSync;
      pendingSync = CallService.getPendingIncomingCall()
        .then((call) => {
          if (!disposed && !activeRef.current) presentIncomingRef.current?.(call);
          return call;
        })
        .catch(() => null)
        .finally(() => { pendingSync = null; });
      return pendingSync;
    };

    const syncIncomingCallById = async (callId) => {
      if (disposed || activeRef.current || !CALL_ID_PATTERN.test(callId || '')) return null;
      try {
        const call = await CallService.getCall(callId);
        if (!disposed && !activeRef.current) presentIncomingRef.current?.(call);
        return call;
      } catch {
        return null;
      } finally {
        if (incomingCallIdFromUrl(globalThis.location?.href, globalThis.location?.origin) === callId) clearIncomingCallFromUrl();
      }
    };

    const syncIncomingNavigation = () => {
      const callId = incomingCallIdFromUrl(globalThis.location?.href, globalThis.location?.origin);
      if (callId) void syncIncomingCallById(callId);
    };

    // Subscribe first, then query. The SUBSCRIBED resync closes the gap where
    // an INSERT can happen after the first query but before the channel joins.
    const unsubscribe = CallService.subscribeToCalls(handleCallChange, {
      onSubscribed: () => { void syncPendingIncomingCall(); },
    });
    void CallService.releaseDeviceCalls(deviceIdRef.current)
      .catch(() => 0)
      .finally(() => {
        if (disposed) return;
        syncIncomingNavigation();
        void syncPendingIncomingCall();
      });

    const resumeIncomingChecks = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        void syncPendingIncomingCall();
      }
    };
    globalThis.addEventListener?.('online', resumeIncomingChecks);
    globalThis.addEventListener?.('focus', resumeIncomingChecks);
    globalThis.document?.addEventListener?.('visibilitychange', resumeIncomingChecks);
    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type !== 'notification-click') return;
      if (event.data?.eventType === 'voice_call' && event.data?.callId) {
        void syncIncomingCallById(event.data.callId);
      }
    };
    globalThis.navigator?.serviceWorker?.addEventListener?.('message', handleServiceWorkerMessage);

    return () => {
      disposed = true;
      unsubscribe();
      globalThis.removeEventListener?.('online', resumeIncomingChecks);
      globalThis.removeEventListener?.('focus', resumeIncomingChecks);
      globalThis.document?.removeEventListener?.('visibilitychange', resumeIncomingChecks);
      globalThis.navigator?.serviceWorker?.removeEventListener?.('message', handleServiceWorkerMessage);
      const active = activeRef.current;
      if (active) {
        // Provider cleanup can be caused by a notification navigation, a hot
        // reload, or React's development lifecycle. Releasing local resources
        // is safe; mutating the authoritative call row here would cancel a
        // still-valid invitation merely because the page remounted.
        releaseResources(active);
        activeRef.current = null;
      }
      clearTerminalTimer();
      stateRef.current = EMPTY_STATE;
    };
  }, [clearTerminalTimer, handleCallChange, updateState, userId]);

  const startCall = useCallback(async (conversation, inviteeIds = null) => {
    CallService.assertAvailable(conversation);
    if (activeRef.current) throw new Error('Finish the current call before starting another.');
    clearTerminalTimer();
    const localStream = await CallService.requestMicrophone();
    let active = null;
    try {
      const call = await CallService.startCall(
        conversation.id,
        deviceIdRef.current,
        inviteeIds,
      );
      active = createActiveCall(call, 'caller');
      active.localStream = localStream;
      activeRef.current = active;
      syncVoiceActivity(active);
      startHeartbeat(active);
      updateState({ ...EMPTY_STATE, phase: 'outgoing', call, isPending: true });
      scheduleRingTimeout(active);
      await loadIceConfiguration(active);
      if (activeRef.current !== active || active.finishing) return call;
      active.signalChannel = await openSignalChannel(call.id);
      if (activeRef.current !== active || active.finishing) {
        void active.signalChannel.unsubscribe();
        return call;
      }
      const wasAnswered = active.call.sessionStatus === CALL_STATUS.ACCEPTED
        || active.call.status === CALL_STATUS.ACCEPTED;
      updateState((current) => ({
        ...current,
        phase: wasAnswered ? 'connecting' : current.phase,
        isPending: false,
      }));
      await sendSignal('peer-ready');
      return call;
    } catch (error) {
      if (activeRef.current === active && active) {
        await finishCallRef.current?.('failed', { persist: true, error: error.message });
      } else {
        stopStream(localStream);
      }
      throw error;
    }
  }, [clearTerminalTimer, loadIceConfiguration, openSignalChannel, scheduleRingTimeout, sendSignal, startHeartbeat, syncVoiceActivity, updateState]);

  const acceptCall = useCallback(async () => {
    const active = activeRef.current;
    if (!active || active.role !== 'callee' || stateRef.current.phase !== 'incoming') return;
    updateState((current) => ({ ...current, isPending: true, error: '' }));
    let localStream = null;
    let channel = null;
    let accepted = false;
    try {
      localStream = await CallService.requestMicrophone();
      if (activeRef.current !== active || active.finishing) {
        stopStream(localStream);
        return;
      }
      await loadIceConfiguration(active);
      if (activeRef.current !== active || active.finishing) {
        stopStream(localStream);
        return;
      }
      channel = await openSignalChannel(active.call.id);
      if (activeRef.current !== active || active.finishing) {
        stopStream(localStream);
        void channel.unsubscribe();
        return;
      }
      active.localStream = localStream;
      active.signalChannel = channel;
      syncVoiceActivity(active);
      const call = await CallService.respondToCall(
        active.call.id,
        true,
        deviceIdRef.current,
      );
      accepted = true;
      if (activeRef.current !== active || active.finishing) return;
      active.call = call;
      scheduleCallLimit(active);
      if (active.ringTimerId) globalThis.clearTimeout(active.ringTimerId);
      active.ringTimerId = null;
      updateState((current) => ({
        ...current,
        phase: 'connecting',
        call,
        isPending: false,
      }));
      await sendSignal('peer-ready');
    } catch (error) {
      if (accepted) {
        await finishCallRef.current?.('failed', {
          persist: true,
          broadcast: true,
          error: error.message || 'Unable to connect this call.',
        });
        return;
      }
      if (active.localStream === localStream) {
        active.localStream = null;
        syncVoiceActivity(active);
      }
      if (active.signalChannel === channel) active.signalChannel = null;
      stopStream(localStream);
      void channel?.unsubscribe?.();
      updateState((current) => ({
        ...current,
        isPending: false,
        error: error.message || 'Unable to answer this call.',
      }));
    }
  }, [loadIceConfiguration, openSignalChannel, scheduleCallLimit, sendSignal, syncVoiceActivity, updateState]);

  const declineCall = useCallback(async () => {
    const active = activeRef.current;
    if (!active || active.role !== 'callee') return;
    updateState((current) => ({ ...current, isPending: true, error: '' }));
    await CallService.respondToCall(active.call.id, false, null).catch(() => {});
    await finishCallRef.current?.('declined');
  }, [updateState]);

  const hangUp = useCallback(async () => {
    const phase = stateRef.current.phase;
    const reason = phase === 'outgoing' ? 'cancelled' : 'ended';
    await finishCallRef.current?.(reason, { persist: true, broadcast: true });
  }, []);

  const toggleMute = useCallback(() => {
    const active = activeRef.current;
    if (!active?.localStream) return;
    const nextMuted = !stateRef.current.isMuted;
    active.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    updateState((current) => ({ ...current, isMuted: nextMuted }));
  }, [updateState]);

  const minimizeCall = useCallback(() => {
    if (!['outgoing', 'connecting', 'connected', 'reconnecting'].includes(stateRef.current.phase)) return;
    updateState((current) => ({ ...current, isMinimized: true }));
  }, [updateState]);

  const expandCall = useCallback(() => {
    updateState((current) => ({ ...current, isMinimized: false }));
  }, [updateState]);

  useEffect(() => {
    if (state.phase === 'incoming' && state.call?.id) {
      startCallRingtone(state.call.id);
    } else {
      stopCallRingtone();
    }
    return () => stopCallRingtone();
  }, [startCallRingtone, state.call?.id, state.phase, stopCallRingtone]);

  const value = useMemo(() => ({
    callState: state,
    speakingUserIds: state.speakingUserIds,
    isBusy: !['idle', 'ended'].includes(state.phase),
    startCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    minimizeCall,
    expandCall,
    dismissEndedCall,
  }), [
    acceptCall,
    declineCall,
    dismissEndedCall,
    hangUp,
    minimizeCall,
    expandCall,
    startCall,
    state,
    toggleMute,
  ]);

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession() {
  const context = useContext(CallSessionContext);
  if (!context) throw new Error('useCallSession must be used within CallSessionProvider.');
  return context;
}
