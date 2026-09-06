import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

function invoke(name, params = {}) {
  return supabase.rpc(name, params);
}

export const trustedFamilySupabaseAdapter = {
  isConfigured: isSupabaseConfigured,
  createInvite: () => invoke('create_m2_trusted_family_invite'),
  acceptInvite: (token) => invoke('accept_m2_trusted_family_invite', { p_token: token }),
  list: () => invoke('list_m2_trusted_family'),
  revoke: (relationshipId) => invoke('revoke_m2_trusted_family', { p_relationship_id: relationshipId })
};
