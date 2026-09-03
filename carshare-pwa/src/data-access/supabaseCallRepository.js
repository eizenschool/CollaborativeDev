// ===== DATA ACCESS LAYER (Supabase Call Repository) =====
import { isSupabaseConfigured, supabase } from './supabaseClient.js';

const CALL_SELECT = `
  *,
  caller:profiles!call_sessions_caller_id_fkey(id, full_name, profile_photo_url),
  callee:profiles!call_sessions_callee_id_fkey(id, full_name, profile_photo_url),
  participants:call_participants(
    call_id, user_id, role, status, device_id, invited_at,
    answered_at, left_at, last_seen_at,
    profile:profiles!call_participants_user_id_fkey(id, full_name, profile_photo_url)
  )
`;

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Voice calls require a configured Supabase connection.');
  }
  return supabase;
}

async function requireUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Sign in before starting a voice call.');
  return data.user.id;
}

function normalizeError(error, fallback) {
  const message = error?.message || error?.details || fallback;
  return Object.assign(new Error(message || fallback), { code: error?.code });
}

function isMissingCallPresenceRpc(error) {
  return error?.code === 'PGRST202'
    || /Could not find the function public\.(?:heartbeat_voice_call|release_voice_call_device)/i
      .test([error?.message, error?.details, error?.hint].filter(Boolean).join(' '));
}

export const supabaseCallRepository = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  getCurrentUserId: requireUserId,

  async getCall(callId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('call_sessions')
      .select(CALL_SELECT)
      .eq('id', callId)
      .maybeSingle();
    if (error) throw normalizeError(error, 'Unable to load this call.');
    return data;
  },

  async listCalls(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('call_sessions')
      .select(CALL_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw normalizeError(error, 'Unable to load call history.');
    return data || [];
  },

  async getPendingIncomingCall() {
    const client = requireSupabase();
    const userId = await requireUserId();
    const earliest = new Date(Date.now() - 45_000).toISOString();
    const { data, error } = await client
      .from('call_participants')
      .select('call_id, invited_at')
      .eq('user_id', userId)
      .eq('role', 'invitee')
      .eq('status', 'ringing')
      .gte('invited_at', earliest)
      .order('invited_at', { ascending: false })
      .limit(1);
    if (error) throw normalizeError(error, 'Unable to check for incoming calls.');
    return data?.[0]?.call_id ? this.getCall(data[0].call_id) : null;
  },

  async startCall(conversationId, callerDeviceId, inviteeIds = null) {
    const client = requireSupabase();
    const rpcName = Array.isArray(inviteeIds)
      ? 'start_selective_voice_call'
      : 'start_voice_call';
    const params = {
      p_conversation_id: conversationId,
      p_caller_device_id: callerDeviceId,
      ...(Array.isArray(inviteeIds) ? { p_invitee_ids: inviteeIds } : {}),
    };
    let { data, error } = await client.rpc(rpcName, params);
    if (error && isMissingCallPresenceRpc(error)) {
      ({ data, error } = await client.rpc('start_voice_call', {
        p_conversation_id: conversationId,
      }));
    }
    if (error) throw normalizeError(error, 'Unable to start this call.');
    return this.getCall(data);
  },

  async respondToCall({ callId, accepted, answerDeviceId }) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('respond_to_voice_call', {
      p_call_id: callId,
      p_accept: accepted,
      p_answer_device_id: accepted ? answerDeviceId : null,
    });
    if (error) throw normalizeError(error, 'Unable to answer this call.');
    return this.getCall(data);
  },

  async endCall({ callId, outcome }) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('end_voice_call', {
      p_call_id: callId,
      p_outcome: outcome,
    });
    if (error) throw normalizeError(error, 'Unable to end this call.');
    return data;
  },

  async heartbeatCall({ callId, deviceId }) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('heartbeat_voice_call', {
      p_call_id: callId,
      p_device_id: deviceId,
    });
    if (error && isMissingCallPresenceRpc(error)) return false;
    if (error) throw normalizeError(error, 'Unable to refresh call presence.');
    return Boolean(data);
  },

  async releaseDeviceCalls(deviceId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('release_voice_call_device', {
      p_device_id: deviceId,
    });
    if (error && isMissingCallPresenceRpc(error)) return 0;
    if (error) throw normalizeError(error, 'Unable to recover interrupted calls.');
    return Number(data) || 0;
  },

  async getTurnIceConfiguration(callId) {
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke('m3-turn-credentials', {
      body: { callId },
    });
    if (error) throw normalizeError(error, 'Unable to load the call relay configuration.');
    return data;
  },

  subscribeToCalls(listener, onStatus) {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const client = supabase;
    const channel = client
      .channel(`voice-call-invites-${Date.now()}-${Math.random()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_sessions' },
        (change) => listener({ ...change, table: 'call_sessions' }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_participants' },
        (change) => listener({ ...change, table: 'call_participants' }),
      )
      .subscribe((status, error) => onStatus?.(status, error));
    return () => { void client.removeChannel(channel); };
  },

  async openSignalChannel(callId, listener) {
    const client = requireSupabase();
    await client.realtime.setAuth();
    const channel = client
      .channel(`m3-call:${callId}`, {
        config: {
          private: true,
          broadcast: { ack: true, self: false },
        },
      })
      .on('broadcast', { event: 'signal' }, (message) => listener(message.payload));

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('The secure call channel timed out.'));
      }, 10_000);

      channel.subscribe((status, error) => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          globalThis.clearTimeout(timeoutId);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled = true;
          globalThis.clearTimeout(timeoutId);
          reject(normalizeError(error, 'Unable to join the secure call channel.'));
        }
      });
    }).catch(async (error) => {
      await client.removeChannel(channel);
      throw error;
    });

    return {
      async send(payload) {
        const status = await channel.send({
          type: 'broadcast',
          event: 'signal',
          payload,
        });
        if (status !== 'ok') throw new Error('A call signal could not be delivered.');
      },
      unsubscribe() {
        return client.removeChannel(channel);
      },
    };
  },
};
