import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

export const vehicleSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  listByOwner(userId) {
    return supabase
      .from('vehicles')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true });
  },

  save(userId, record) {
    if (record.id) {
      const { id, owner_id: _ownerId, ...patch } = record;
      return supabase
        .from('vehicles')
        .update(patch)
        .eq('id', id)
        .eq('owner_id', userId)
        .select()
        .single();
    }

    const { id: _id, ...insertRecord } = record;
    return supabase.from('vehicles').insert(insertRecord).select().single();
  },

  remove(userId, vehicleId) {
    return supabase.from('vehicles').delete().eq('id', vehicleId).eq('owner_id', userId);
  },

  async setActive(userId, vehicleId, active) {
    if (active) {
      const { error } = await supabase
        .from('vehicles')
        .update({ active: false })
        .eq('owner_id', userId);
      if (error) return { data: null, error };
    }

    return supabase
      .from('vehicles')
      .update({ active })
      .eq('id', vehicleId)
      .eq('owner_id', userId)
      .select()
      .single();
  }
};
