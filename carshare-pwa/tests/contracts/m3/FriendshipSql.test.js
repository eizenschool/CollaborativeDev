import { describe, expect, it } from 'vitest';

async function migration() {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../../database/sql/079_m3_friendships_and_persistent_chat.sql', import.meta.url), 'utf8');
  return sql.replace(/\r\n/g, '\n');
}

describe('friendship and persistent-chat migration', () => {
  it('uses one canonical, participant-readable relationship row per account pair', async () => {
    const sql = await migration();
    expect(sql).toContain('create table public.friendships');
    expect(sql).toContain('check (member_low_id::text < member_high_id::text)');
    expect(sql).toContain('unique (member_low_id, member_high_id)');
    expect(sql).toContain('alter table public.friendships enable row level security');
    expect(sql).toContain('grant select on table public.friendships to authenticated');
    expect(sql).not.toMatch(/grant (insert|update|delete).*friendships.*authenticated/i);
  });

  it('serializes pair mutations and rejects invalid request transitions', async () => {
    const sql = await migration();
    expect(sql.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql.match(/for update/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('You cannot add yourself as a friend');
    expect(sql).toContain('This member has already sent you a friend request');
    expect(sql).toContain("v_friendship.requested_by <> p_other_user_id");
    expect(sql).toContain("status = 'active'");
  });

  it('creates exactly one non-expiring friend conversation and reuses it', async () => {
    const sql = await migration();
    expect(sql).toContain('conversations_one_friend_per_friendship_idx');
    expect(sql).toContain('on public.conversations (friendship_id)');
    expect(sql).toContain('on conflict (friendship_id)');
    expect(sql).toContain("'friend', v_friendship.id, 'direct', null, null, null");
    expect(sql).toContain("check (role in ('host', 'traveller', 'friend'))");
    expect(sql).toContain('deleted_before = now()');
    const ensureFunction = sql.slice(
      sql.indexOf('create or replace function private.ensure_friend_conversation'),
      sql.indexOf('create or replace function private.friendship_payload'),
    );
    expect(ensureFunction).not.toContain('deleted_before = null');
    expect(ensureFunction).not.toContain('archived_at = null');
  });

  it('keeps history readable but gates messages and calls on accepted active accounts', async () => {
    const sql = await migration();
    expect(sql).toContain("c.scope = 'friend'");
    expect(sql).toContain("f.status = 'accepted'");
    expect(sql).toContain('low_profile.status = \'active\'');
    expect(sql).toContain('high_profile.status = \'active\'');
    expect(sql).toContain("where conversation_id = v_conversation_id and status in ('ringing', 'accepted')");
    expect(sql).toContain("c.scope = 'friend'\n        or (c.scope = 'ride'");
    expect(sql).toContain('private.profile_is_relevant_to_viewer');
    expect(sql).toContain('grant execute on function private.profile_is_relevant_to_viewer(uuid, uuid)');
  });

  it('emits only request and acceptance notifications and publishes friendship changes', async () => {
    const sql = await migration();
    expect(sql).toContain("'friend_request'");
    expect(sql).toContain("'/message/friends'");
    expect(sql).toContain("'friend_accepted'");
    expect(sql).toContain("'/message/' || v_conversation_id::text");
    expect(sql).not.toContain("'friend_removed'");
    expect(sql).toContain('alter publication supabase_realtime add table public.friendships');
  });

  it('revokes broad RPC access and grants only authenticated execution', async () => {
    const sql = await migration();
    for (const signature of [
      'get_friend_relationship(uuid)',
      'list_friend_connections()',
      'send_friend_request(uuid)',
      'respond_to_friend_request(uuid, boolean)',
      'cancel_friend_request(uuid)',
      'remove_friend(uuid)',
      'open_friend_conversation(uuid)',
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated`);
    }
  });
});
