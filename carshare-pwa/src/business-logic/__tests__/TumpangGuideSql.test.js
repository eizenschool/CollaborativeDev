import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const sql = readFileSync(resolve(root, 'database/sql/079_m6_tumpang_guide.sql'), 'utf8');
const stabilitySql = readFileSync(resolve(root, 'database/sql/080_m6_tumpang_guide_stability.sql'), 'utf8');

describe('Tumpang Guide SQL security contract', () => {
  it('creates the private Guide domain and 768-dimensional Help embeddings', () => {
    for (const table of ['ai_guide_sessions', 'ai_guide_messages', 'ai_guide_recommendations', 'ai_guide_feedback', 'ai_help_sections', 'place_travel_attributes', 'place_catalogue_requests']) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('embedding extensions.vector(768)');
    expect(sql).toContain('ai_help_sections_embedding_hnsw_idx');
    expect(sql).toContain('set search_path = extensions, pg_catalog');
    expect(sql).toContain('h.embedding <=> p_embedding');
  });

  it('allows owners to read history but keeps all AI writes server-only', () => {
    expect(sql).toContain('guide owners read their sessions');
    expect(sql).toContain('guide owners delete their sessions');
    expect(sql).not.toMatch(/grant\s+insert[^;]+ai_guide_(sessions|messages|recommendations|feedback)\s+to authenticated/is);
    expect(sql).toContain('to service_role');
    expect(sql).toContain('Guide session ownership mismatch');
  });

  it('provides atomic persistence, server rate limits and 90-day deletion', () => {
    expect(sql).toContain('create or replace function public.m6_guide_persist_turn');
    expect(sql).toContain('create or replace function public.m6_guide_check_quota');
    expect(sql).toContain("now() + interval '90 days'");
    expect(sql).toContain("'m6-tumpang-guide-retention'");
    expect(sql).toContain('delete from public.ai_guide_sessions where expires_at <= now()');
  });

  it('routes accepted or rejected catalogue requests through the existing notification centre', () => {
    expect(sql).toContain('private.create_user_notification');
    expect(sql).toContain("new.status not in ('accepted', 'rejected')");
    expect(sql).toContain("'m6:catalogue:'");
  });

  it('adds stable batches and versioned language-pack/translation RPCs without opening browser writes', () => {
    expect(stabilitySql).toContain('add column if not exists batch_id uuid');
    expect(stabilitySql).toContain('ai_guide_messages_owner_batch_idx');
    expect(stabilitySql).toContain('ai_guide_recommendations_owner_batch_idx');
    expect(stabilitySql).toContain('private.ai_guide_language_packs');
    expect(stabilitySql).toContain('m6_guide_persist_turn_v2');
    expect(stabilitySql).toContain('m6_guide_upgrade_batch');
    expect(stabilitySql).toContain('m6_guide_cache_translation');
    expect(stabilitySql).toContain('m6_guide_clear_feedback');
    expect(stabilitySql).toMatch(/revoke all on function public\.m6_guide_upgrade_batch[\s\S]*from public, anon, authenticated/);
    expect(stabilitySql).toMatch(/grant execute on function public\.m6_guide_upgrade_batch[\s\S]*to service_role/);
    expect(stabilitySql).toContain("p_language !~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'");
  });
});
