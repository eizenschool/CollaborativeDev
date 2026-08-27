// ===== DATA ACCESS LAYER (Supabase Call Repository) =====
import { isSupabaseConfigured, supabase } from './supabaseClient.js';

const CALL_SELECT = `
  *,
  caller:profiles!call_sessions_caller_id_fkey(id, full_name, profile_photo_url),
  callee:profiles!call_sessions_callee_id_fkey(id, full_name, profile_photo_url)
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
  return new Error(message || fallback);
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
      .from('call_sessions')
      .select(CALL_SELECT)
      .eq('callee_id', userId)
      .eq('status', 'ringing')
      .gte('created_at', earliest)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw normalizeError(error, 'Unable to check for incoming calls.');
    return data?.[0] || null;
  },

  async startCall(conversationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('start_voice_call', {
      p_conversation_id: conversationId,
    });
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
        listener,
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
