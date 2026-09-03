import { isSupabaseConfigured, supabase } from './supabaseClient.js';

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw Object.assign(new Error('Friends requires a configured Supabase connection.'), {
      code: 'FRIENDSHIP_UNAVAILABLE',
    });
  }
  return supabase;
}

function normalizeError(error, fallback) {
  const message = error?.message?.replace(/^.*?: /, '') || fallback;
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const deploymentPending = ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01'].includes(error?.code)
    && /friend|relationship|schema cache|function/i.test(details);
  return Object.assign(new Error(deploymentPending
    ? 'Friends is not available until the latest database migration is deployed.'
    : message), {
    code: deploymentPending ? 'FRIENDSHIP_UNAVAILABLE' : error?.code,
  });
}

async function runRpc(name, params, fallback) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(name, params);
  if (error) throw normalizeError(error, fallback);
  return data;
}

export const supabaseFriendshipRepository = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  getRelationship(otherUserId) {
    return runRpc('get_friend_relationship', {
      p_other_user_id: otherUserId,
    }, 'Unable to load this friendship.');
  },

  listConnections() {
    return runRpc('list_friend_connections', {}, 'Unable to load friends.');
  },

  sendRequest(otherUserId) {
    return runRpc('send_friend_request', {
      p_other_user_id: otherUserId,
    }, 'Unable to send this friend request.');
  },

  respondToRequest(otherUserId, accept) {
    return runRpc('respond_to_friend_request', {
      p_other_user_id: otherUserId,
      p_accept: Boolean(accept),
    }, 'Unable to respond to this friend request.');
  },

  cancelRequest(otherUserId) {
    return runRpc('cancel_friend_request', {
      p_other_user_id: otherUserId,
    }, 'Unable to cancel this friend request.');
  },

  removeFriend(otherUserId) {
    return runRpc('remove_friend', {
      p_other_user_id: otherUserId,
    }, 'Unable to remove this friend.');
  },

  openConversation(otherUserId) {
    return runRpc('open_friend_conversation', {
      p_other_user_id: otherUserId,
    }, 'Unable to open this friend chat.');
  },

  subscribe(listener) {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const client = supabase;
    const channel = client
      .channel(`friendships-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
      }, listener);
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  },
};
