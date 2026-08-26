import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';

function clientOrThrow() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Trusted Family requires a configured Supabase connection.');
  }
  return supabase;
}

async function rpc(name, params = {}, fallback) {
  const { data, error } = await clientOrThrow().rpc(name, params);
  if (error) throw new Error(error.message?.replace(/^.*?: /, '') || fallback);
  return data;
}

export const TrustedFamilyService = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  createInvite() {
    return rpc('create_m2_trusted_family_invite', {}, 'Unable to create a trusted family invitation.');
  },

  acceptInvite(token) {
    return rpc('accept_m2_trusted_family_invite', { p_token: token }, 'Unable to accept this trusted family invitation.');
  },

  async listTrustedFamily() {
    const data = await rpc('list_m2_trusted_family', {}, 'Unable to load trusted family.');
    return Array.isArray(data) ? data : [];
  },

  revokeRelationship(relationshipId) {
    return rpc('revoke_m2_trusted_family', { p_relationship_id: relationshipId }, 'Unable to revoke this trusted family member.');
  }
};
