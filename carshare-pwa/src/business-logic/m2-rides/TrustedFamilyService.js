import { trustedFamilySupabaseAdapter } from '../../data-access/m2-rides/trustedFamilySupabaseAdapter.js';

function assertConfigured() {
  if (!trustedFamilySupabaseAdapter.isConfigured) {
    throw new Error('Trusted Family requires a configured Supabase connection.');
  }
}

async function run(request, fallback) {
  assertConfigured();
  const { data, error } = await request();
  if (error) throw new Error(error.message?.replace(/^.*?: /, '') || fallback);
  return data;
}

export const TrustedFamilyService = {
  backend: trustedFamilySupabaseAdapter.isConfigured ? 'supabase' : 'unconfigured',

  createInvite() {
    return run(() => trustedFamilySupabaseAdapter.createInvite(), 'Unable to create a trusted family invitation.');
  },

  acceptInvite(token) {
    return run(() => trustedFamilySupabaseAdapter.acceptInvite(token), 'Unable to accept this trusted family invitation.');
  },

  async listTrustedFamily() {
    const data = await run(() => trustedFamilySupabaseAdapter.list(), 'Unable to load trusted family.');
    return Array.isArray(data) ? data : [];
  },

  revokeRelationship(relationshipId) {
    return run(() => trustedFamilySupabaseAdapter.revoke(relationshipId), 'Unable to revoke this trusted family member.');
  }
};
