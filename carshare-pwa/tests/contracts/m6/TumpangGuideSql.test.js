import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const sql = readFileSync(resolve(root, 'database/sql/083_m6_tumpang_guide.sql'), 'utf8');
const stabilitySql = readFileSync(resolve(root, 'database/sql/084_m6_tumpang_guide_stability.sql'), 'utf8');
const reliabilitySql = readFileSync(resolve(root, 'database/sql/085_m6_guide_agent_reliability.sql'), 'utf8');
const routeBudgetSql = readFileSync(resolve(root, 'database/sql/086_m6_guide_route_budget.sql'), 'utf8');

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

  it('keeps v3 turn idempotency, provider health and live facts private', () => {
    for (const table of ['ai_guide_turn_requests', 'ai_guide_provider_attempts', 'ai_guide_provider_health', 'ai_guide_live_fact_cache']) {
      expect(reliabilitySql).toContain(`create table if not exists private.${table}`);
      expect(reliabilitySql).toContain(`alter table private.${table} enable row level security`);
      expect(reliabilitySql).toContain(`alter table private.${table} force row level security`);
    }
    expect(reliabilitySql).toContain('primary key (actor_key, client_turn_id)');
    expect(reliabilitySql).toContain('create or replace function public.m6_claim_ai_guide_turn');
    expect(reliabilitySql).toContain('create or replace function public.m6_complete_ai_guide_turn');
    expect(reliabilitySql).toContain('create or replace function public.m6_fail_ai_guide_turn');
    expect(reliabilitySql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(reliabilitySql).toMatch(/revoke execute on function public\.m6_claim_ai_guide_turn[\s\S]*from public, anon, authenticated/i);
    expect(reliabilitySql).toMatch(/grant execute on function public\.m6_claim_ai_guide_turn[\s\S]*to service_role/i);
    expect(reliabilitySql).not.toMatch(/\b(?:raw_message|raw_prompt|audio_data)\s+(?:text|bytea|jsonb)\b/i);
  });

  it('gives the Guide its own smaller, idempotent daily route budget that still spends the shared M2 quota', () => {
    for (const table of ['m6_guide_route_daily_usage', 'm6_guide_route_usage_requests']) {
      expect(routeBudgetSql).toContain(`create table if not exists private.${table}`);
      expect(routeBudgetSql).toContain(`revoke all on table private.${table} from public, anon, authenticated`);
    }
    expect(routeBudgetSql).toContain('request_count between 0 and 40');
    expect(routeBudgetSql).toMatch(/create or replace function public\.consume_m6_guide_route_quota\(p_request_id uuid\)[\s\S]*security definer/i);
    expect(routeBudgetSql).toContain("set search_path = ''");
    expect(routeBudgetSql).toContain("(now() at time zone 'Asia/Kuala_Lumpur')::date");
    // The Guide's own cap must be checked - and therefore fail - before the
    // shared M2 quota is ever touched, so a Guide-exhausted day never spends
    // a slot from the pool Module 2's paid flow depends on.
    expect(routeBudgetSql.indexOf('M6_GUIDE_ROUTE_BUDGET'))
      .toBeLessThan(routeBudgetSql.indexOf('perform public.consume_m2_route_quota'));
    expect(routeBudgetSql).toContain('perform public.consume_m2_route_quota(p_request_id)');
    expect(routeBudgetSql).toMatch(/revoke all on function public\.consume_m6_guide_route_quota\(uuid\)[\s\S]*from public, anon, authenticated/i);
    expect(routeBudgetSql).toMatch(/grant execute on function public\.consume_m6_guide_route_quota\(uuid\)[\s\S]*to service_role/i);
  });
});
