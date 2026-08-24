// ===== DATA ACCESS LAYER (Supabase Notification Repository) =====
import { supabase, isSupabaseConfigured } from './supabaseClient.js';

const NOTIFICATION_SELECT = 'id, source_module, event_type, title, body, action_path, payload, created_at, read_at';

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Notifications require a configured Supabase connection.');
  }
  return supabase;
}

function normalizeError(error, fallback) {
  const message = error?.message?.replace(/^.*?: /, '') || fallback;
  return Object.assign(new Error(message), { code: error?.code });
}

export const supabaseNotificationRepository = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  async listNotifications(limit, { excludeEventType, excludeEventTypes = [] } = {}) {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase
      .from('user_notifications')
      .select(NOTIFICATION_SELECT);
    const excluded = excludeEventTypes.length
      ? excludeEventTypes
      : excludeEventType ? [excludeEventType] : [];
    excluded.forEach((eventType) => { query = query.neq('event_type', eventType); });
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw normalizeError(error, 'Unable to load notifications.');
    return data || [];
  },

  async markRead(notificationId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    });
    if (error) throw normalizeError(error, 'Unable to mark this notification as read.');
    return data;
  },

  async markAllRead() {
    const client = requireSupabase();
    const { data, error } = await client.rpc('mark_all_notifications_read');
    if (error) throw normalizeError(error, 'Unable to mark notifications as read.');
    return data || 0;
  },

  async savePushSubscription(subscription) {
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke('notification-subscriptions', {
      body: { action: 'upsert', subscription },
    });
    if (error || !data?.ok) throw normalizeError(error || data, 'Unable to enable device notifications.');
    return true;
  },

  async removePushSubscription(endpoint) {
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke('notification-subscriptions', {
      body: { action: 'remove', endpoint },
    });
    if (error || !data?.ok) throw normalizeError(error || data, 'Unable to disable device notifications.');
    return true;
  },

  subscribe(listener) {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const channel = supabase
      .channel(`notifications-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications' }, listener)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
};
