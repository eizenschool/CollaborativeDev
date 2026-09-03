import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(relativeUrl, import.meta.url),
    'utf8',
  ));
}

describe('Module 3 translation security contract', () => {
  it('makes cached translations member-readable and Edge-Function-writable only', async () => {
    const sql = await read('../../../database/sql/036_m3_message_translation.sql');
    expect(sql).toContain('alter table public.message_translations enable row level security');
    expect(sql).toContain('private.conversation_is_visible');
    expect(sql).toContain('m.deleted_at is null');
    expect(sql).toContain('grant select on table public.message_translations to authenticated');
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all).*message_translations.*authenticated/i);
    expect(sql).toContain('primary key (message_id, target_language)');
    expect(sql).toContain("target_language in ('en', 'zh', 'ms', 'ta')");
  });

  it('keeps Cloudflare credentials server-side and resolves sources by message id', async () => {
    const edgeFunction = await read('../../../supabase/functions/m3-message-translation/index.ts');
    expect(edgeFunction).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(edgeFunction).toContain('CLOUDFLARE_AI_TOKEN');
    expect(edgeFunction).not.toContain('VITE_CLOUDFLARE');
    expect(edgeFunction).toContain('.eq("user_id", userId)');
    expect(edgeFunction).toContain('conversation?.expires_at');
    expect(edgeFunction).toContain('member?.access_expires_at');
    expect(edgeFunction).toContain('member?.left_at');
    expect(edgeFunction).toContain('member?.deleted_before');
    expect(edgeFunction).toContain('message.deleted_at');
    expect(edgeFunction).toContain('FREE_TIER_EXHAUSTED');
    expect(edgeFunction).toContain('completionText(result)');
  });
});
