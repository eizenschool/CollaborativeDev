import { describe, expect, it } from 'vitest';

async function migration() {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL('../../../database/sql/075_m3_conversation_lifecycle_redesign.sql', import.meta.url), 'utf8');
}

describe('ride-bound conversation lifecycle migration', () => {
  it('retains terminal ride conversations for seven days', async () => {
    const sql = await migration();
    expect(sql).toContain('c.expires_at > now()');
    expect(sql).toContain("access_expires_at = v_left_at + interval '7 days'");
    expect(sql).toContain('private.conversation_is_visible');
    expect(sql).toContain('private.message_is_visible');
    expect(sql).toContain('private.call_is_visible');
  });

  it('restricts all personal controls to terminal rides', async () => {
    const sql = await migration();
    for (const name of ['archive_conversation', 'unarchive_conversation', 'delete_conversation_for_me', 'set_conversation_muted']) {
      expect(sql).toContain(`public.${name}`);
    }
    expect(sql.match(/c\.ride_status in \('Completed', 'Cancelled', 'Expired'\)/g)).toHaveLength(4);
    expect(sql).toContain('deleted_before timestamptz');
    expect(sql).toContain('muted_at timestamptz');
  });

  it('removes a requester from the group while retaining only earlier history', async () => {
    const sql = await migration();
    expect(sql).toContain("old.status = 'Accepted'");
    expect(sql).toContain("new.status = 'Cancelled'");
    expect(sql).toContain("new.cancelled_by = 'Requester'");
    expect(sql).toContain('m.created_at <= cm.left_at');
    expect(sql).toContain('sync_cancelled_request_group_membership');
    expect(sql).toContain('set left_at = null, access_expires_at = null');
  });

  it('keeps completed groups writable but makes cancelled and expired groups read-only', async () => {
    const sql = await migration();
    expect(sql).toContain("c.type = 'group'");
    expect(sql).toContain("c.ride_status in ('Cancelled', 'Expired')");
    expect(sql).toContain('private.reject_read_only_group_message_mutation');
    expect(sql).toContain('revoke all on function public.leave_group_conversation(uuid)');
  });

  it('suppresses message notifications for muted members and secures lifecycle RPCs', async () => {
    const sql = await migration();
    expect(sql).toContain("new.event_type = 'message'");
    expect(sql).toContain('cm.muted_at is not null');
    expect(sql).toContain('return null');
    for (const signature of ['public.archive_conversation(uuid)', 'public.unarchive_conversation(uuid)', 'public.delete_conversation_for_me(uuid)', 'public.set_conversation_muted(uuid, boolean)']) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    }
  });
});
