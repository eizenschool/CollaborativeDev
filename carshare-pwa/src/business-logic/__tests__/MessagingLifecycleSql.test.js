import { describe, expect, it } from 'vitest';

async function migration() {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL('../../../database/sql/075_m3_conversation_lifecycle_redesign.sql', import.meta.url), 'utf8');
}

describe('persistent conversation lifecycle migration', () => {
  it('makes direct conversations pair-owned and migrates duplicate timelines', async () => {
    const sql = await migration();
    expect(sql).toContain('conversations_one_direct_per_pair_idx');
    expect(sql).toContain('m3_direct_merge_map');
    expect(sql).toContain('update public.messages m');
    expect(sql).toContain('update public.call_sessions cs');
    expect(sql).toContain('conversation_aliases');
    expect(sql).toContain('conversation_ride_contexts');
    expect(sql).toContain("set ride_id = null");
  });

  it('uses personal archive/delete state without expiry or terminal write gates', async () => {
    const sql = await migration();
    expect(sql).toContain('deleted_before timestamptz');
    expect(sql).toContain('public.unarchive_conversation');
    expect(sql).toContain('public.delete_conversation_for_me');
    expect(sql).toContain('set archived_at = null');
    expect(sql).toContain('private.message_is_visible');
    expect(sql).not.toContain("+ interval '7 days'");
    expect(sql).not.toContain('expires_at > now()');
  });

  it('keeps ended groups writable and closes atomically after the final traveller', async () => {
    const sql = await migration();
    expect(sql).toContain("c.ride_status in ('Completed', 'Cancelled', 'Expired')");
    expect(sql).toContain("role = 'traveller' and left_at is null");
    expect(sql).toContain("role = 'host' and left_at is null");
    expect(sql).toContain('set closed_at = now()');
    expect(sql).toContain("|| ' left the group.'");
  });

  it('enforces symmetric account blocking while preserving accepted rides', async () => {
    const sql = await migration();
    expect(sql).toContain('create table public.user_blocks');
    expect(sql).toContain('private.users_are_blocked');
    expect(sql).toContain('private.users_share_accepted_ride');
    expect(sql).toContain("status = 'Cancelled', cancelled_by = 'System'");
    expect(sql).toContain('guard_blocked_ride_request');
    expect(sql).toContain('blocked accounts restrict ride visibility');
    expect(sql).toContain('search_public_multi_leg_journeys');
  });

  it('revokes default RPC access and explicitly enables RLS tables', async () => {
    const sql = await migration();
    for (const table of ['user_blocks', 'conversation_ride_contexts', 'conversation_aliases']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    for (const signature of [
      'public.block_user(uuid)',
      'public.unblock_user(uuid)',
      'public.delete_conversation_for_me(uuid)',
      'public.unarchive_conversation(uuid)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    }
  });
});
