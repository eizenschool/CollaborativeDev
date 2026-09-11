import { describe, expect, it } from 'vitest';

async function migration() {
  const { readFile } = await import('node:fs/promises');
  return readFile(
    new URL('../../../supabase/migrations/20260905092210_m3_friend_ride_invitations.sql', import.meta.url),
    'utf8',
  );
}

describe('Friend-chat Ride invitation migration', () => {
  it('stores only a Ride reference on a visible message and exposes no client writes', async () => {
    const sql = await migration();
    expect(sql).toContain('create table public.message_ride_invitations');
    expect(sql).toContain('message_id uuid primary key references public.messages(id) on delete cascade');
    expect(sql).toContain('ride_id uuid not null references public.rides(id) on delete restrict');
    expect(sql).toContain('alter table public.message_ride_invitations enable row level security');
    expect(sql).toContain('private.message_is_visible(message_id');
    expect(sql).toContain('grant select on table public.message_ride_invitations to authenticated');
    expect(sql).not.toMatch(/grant (insert|update|delete).*message_ride_invitations.*authenticated/i);
  });

  it('allows a Host or a Pending/Accepted passenger to share only with an eligible friend', async () => {
    const sql = await migration();
    expect(sql).toContain("r.host_id = v_user_id");
    expect(sql).toContain("sender_request.status in ('Pending', 'Accepted')");
    expect(sql).toContain("friend_request.status in ('Pending', 'Accepted', 'Rejected')");
    expect(sql).toContain("r.status = 'Published'");
    expect(sql).toContain("r.departure_at - interval '1 hour' >= now()");
    expect(sql).toContain('r.host_id <> v_friend_id');
  });

  it('rechecks an accepted writable Friend chat and Ride eligibility in the send transaction', async () => {
    const sql = await migration();
    const sendFunction = sql.slice(
      sql.indexOf('create or replace function public.send_friend_ride_invitation'),
      sql.indexOf('create or replace function private.remove_deleted_ride_invitation_payload'),
    );
    expect(sendFunction).toContain("c.scope = 'friend'");
    expect(sendFunction).toContain("c.type = 'direct'");
    expect(sendFunction).toContain('private.conversation_is_writable(c.id, v_user_id)');
    expect(sendFunction).toContain('for update of c, own_member, other_member');
    expect(sendFunction).toContain('where id = p_ride_id for update');
    expect(sendFunction).toContain('insert into public.messages');
    expect(sendFunction).toContain('insert into public.message_ride_invitations');
  });

  it('resolves live Ride state, deep-links notifications, and removes deleted card payloads', async () => {
    const sql = await migration();
    expect(sql).toContain('get_friend_ride_invitation_cards');
    expect(sql).toContain("'ride_invitation'");
    expect(sql).toContain("'/message/' || p_conversation_id::text");
    expect(sql).toContain('remove_deleted_ride_invitation_payload');
    expect(sql).toContain('delete from public.message_ride_invitations where message_id = new.id');
  });

  it('revokes broad RPC access before granting authenticated execution', async () => {
    const sql = await migration();
    for (const signature of [
      'list_friend_ride_invite_options(uuid)',
      'get_friend_ride_invitation_cards(uuid)',
      'send_friend_ride_invitation(uuid, uuid, uuid, text)',
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated`);
    }
  });
});
