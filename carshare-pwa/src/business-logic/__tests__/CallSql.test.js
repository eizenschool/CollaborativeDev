import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(relativeUrl, import.meta.url),
    'utf8',
  ));
}

describe('Module 3 voice-call security contract', () => {
  it('keeps call rows participant-readable and every mutation RPC-only', async () => {
    const sql = await read('../../../database/sql/043_m3_add_voice_calls.sql');
    expect(sql).toContain('alter table public.call_sessions enable row level security');
    expect(sql).toContain('(select auth.uid()) in (caller_id, callee_id)');
    expect(sql).toContain('grant select on table public.call_sessions to authenticated');
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all).*call_sessions.*authenticated/i);
    expect(sql).toContain("c.type = 'direct'");
    expect(sql).toContain('current_member.archived_at is null');
    expect(sql).toContain('other_member.archived_at is null');
    expect(sql).toContain('private.conversation_is_writable');
    expect(sql).toContain('caller_id <> callee_id');
  });

  it('authorizes private Broadcast topics using the active call participants', async () => {
    const sql = await read('../../../database/sql/043_m3_add_voice_calls.sql');
    expect(sql).toContain('on realtime.messages for select to authenticated');
    expect(sql).toContain('on realtime.messages for insert to authenticated');
    expect(sql).toContain("realtime.messages.extension = 'broadcast'");
    expect(sql).toContain("'m3-call:' || cs.id::text");
    expect(sql).toContain("cs.status in ('ringing', 'accepted')");
    expect(sql).toContain("alter publication supabase_realtime add table public.call_sessions");
  });

  it('grants only authenticated execution after revoking default PUBLIC access', async () => {
    const sql = await read('../../../database/sql/043_m3_add_voice_calls.sql');
    for (const signature of [
      'public.start_voice_call(uuid)',
      'public.respond_to_voice_call(uuid, boolean, text)',
      'public.end_voice_call(uuid, text)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    }
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('security definer');
  });

  it('keeps TURN allowance and credential metadata server-only', async () => {
    const sql = await read('../../../database/sql/044_m3_turn_guard.sql');
    expect(sql).toContain('cutoff_bytes bigint not null default 900000000000');
    expect(sql).toContain('alter table public.turn_usage_guard enable row level security');
    expect(sql).toContain('alter table public.turn_credential_issues enable row level security');
    expect(sql).toContain('revoke all on table public.turn_usage_guard from public, anon, authenticated');
    expect(sql).toContain('revoke all on table public.turn_credential_issues from public, anon, authenticated');
    expect(sql).toContain("issue.issued_at >= now() - interval '1 hour'");
    expect(sql).toContain(') >= 10 then');
    expect(sql).toContain("answered_at <= now() - interval '60 minutes'");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all).*turn_.*authenticated/i);
  });

  it('keeps long-lived TURN secrets out of Vite and secures both Edge Functions', async () => {
    const [environment, config, credentials, monitor, repository] = await Promise.all([
      read('../../../.env.example'),
      read('../../../supabase/config.toml'),
      read('../../../supabase/functions/m3-turn-credentials/index.ts'),
      read('../../../supabase/functions/m3-turn-usage-monitor/index.ts'),
      read('../../data-access/supabaseCallRepository.js'),
    ]);
    expect(environment).not.toContain('VITE_WEBRTC_TURN_');
    expect(environment).toContain('CLOUDFLARE_TURN_API_TOKEN=');
    expect(config).toMatch(/\[functions\.m3-turn-credentials\]\s+verify_jwt = true/);
    expect(config).toMatch(/\[functions\.m3-turn-usage-monitor\]\s+verify_jwt = false/);
    expect(credentials).toContain('await authenticatedUserId(user)');
    expect(credentials).toContain('await activeParticipantCall(admin, callId, userId)');
    expect(monitor).toContain('x-m3-turn-monitor-secret');
    expect(repository).toContain('await client.realtime.setAuth()');
  });

  it('creates one push-only incoming-call notification without widening call access', async () => {
    const sql = await read('../../../database/sql/045_m3_reliable_voice_call_delivery.sql');
    expect(sql).toContain('create or replace function private.notify_incoming_voice_call()');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("'voice_call'");
    expect(sql).toContain("'voice-call:' || new.id::text");
    expect(sql).toContain("when (new.status = 'ringing')");
    expect(sql).toContain('revoke all on function private.notify_incoming_voice_call()');
    expect(sql).not.toMatch(/grant\s+execute.*notify_incoming_voice_call/i);
  });

  it('protects retained call history with current conversation visibility', async () => {
    const sql = await read('../../../database/sql/065_m3_terminal_chat_and_call_history.sql');
    expect(sql).toContain('private.conversation_is_visible(conversation_id, (select auth.uid()))');
    expect(sql).toContain('(select auth.uid()) in (caller_id, callee_id)');
    expect(sql).toContain("v_conversation.ride_status not in ('Completed', 'Cancelled', 'Expired')");
    expect(sql).toContain("v_conversation.type <> 'direct'");
    expect(sql).toContain("v_conversation.type <> 'group'");
    expect(sql).toContain("v_role <> 'traveller'");
    expect(sql).toContain('update public.conversation_members');
    expect(sql).toContain('set archived_at = coalesce(archived_at, now())');
    expect(sql).toContain('set left_at = now()');
  });
});
