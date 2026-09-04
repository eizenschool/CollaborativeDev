// ===== DATA ACCESS LAYER (Tumpang Guide live Supabase history) =====
// AI writes stay in the Edge Function. This adapter uses RLS only for an
// authenticated owner reading or deleting their own saved plans.
import { supabase } from './supabaseClient.js';

function client() {
  if (!supabase) throw new Error('Supabase is not configured for Tumpang Guide.');
  return supabase;
}

function mapSession(row) {
  return {
    id: row.id,
    userId: row.owner_id,
    language: row.language,
    title: row.title,
    planState: row.plan_state || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at
  };
}

export const tumpangGuideSupabaseRepository = {
  async listSessions(userId) {
    if (!userId) return [];
    const { data, error } = await client()
      .from('ai_guide_sessions')
      .select('id,owner_id,language,title,plan_state,created_at,updated_at,expires_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSession);
  },

  async getMessages(userId, sessionId) {
    if (!userId || !sessionId) return [];
    const { data, error } = await client()
      .from('ai_guide_messages')
      .select('id,session_id,owner_id,role,content,structured_payload,trace_id,created_at')
      .eq('owner_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id, sessionId: row.session_id, userId: row.owner_id,
      role: row.role, text: row.content, response: row.structured_payload,
      traceId: row.trace_id, createdAt: row.created_at
    }));
  },

  async listFeedback(userId, sessionId) {
    if (!userId || !sessionId) return [];
    const { data, error } = await client()
      .from('ai_guide_feedback')
      .select('trace_id,sentiment,reason_code')
      .eq('owner_id', userId)
      .eq('session_id', sessionId);
    if (error) throw error;
    return (data || []).map((row) => ({
      traceId: row.trace_id,
      sentiment: row.sentiment,
      reason: row.reason_code
    }));
  },

  async deleteSession(userId, sessionId) {
    if (!userId || !sessionId) return false;
    const { error } = await client()
      .from('ai_guide_sessions')
      .delete()
      .eq('owner_id', userId)
      .eq('id', sessionId);
    if (error) throw error;
    return true;
  },

  async deleteAll(userId) {
    if (!userId) return 0;
    const { data, error } = await client()
      .from('ai_guide_sessions')
      .delete()
      .eq('owner_id', userId)
      .select('id');
    if (error) throw error;
    return data?.length || 0;
  },

  async requestCataloguePlace(requestedName) {
    const { data, error } = await client().rpc('m6_request_catalogue_place', {
      p_requested_name: requestedName
    });
    if (error) throw error;
    return data;
  }
};
