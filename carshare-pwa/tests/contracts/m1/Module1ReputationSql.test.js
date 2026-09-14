import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

describe('Module 1 reputation and public-profile SQL contracts', () => {
  // Asserts what 072 itself still contains, not the current policy: D034's
  // 100 origin and 90/75 gates supersede its constants through 087_m1, which
  // Module1IdentityGate.test.js covers. Deployed history is never rewritten.
  it('keeps reputation event-driven, idempotent and enforced at ride mutations', async () => {
    const sql = await read('../../../database/sql/072_m1_reputation_events_and_eligibility.sql');
    expect(sql).toContain('create table public.reputation_events');
    expect(sql).toContain('unique (user_id, source_module, source_event_id, event_type)');
    expect(sql).toContain('greatest(0, 3 - v_existing_positive)');
    expect(sql).toContain('enforce_ride_reputation_before_publish');
    expect(sql).toContain('enforce_request_reputation_before_insert');
    expect(sql).toContain('v_evidence >= 3 and v_score < 65');
    expect(sql).toContain('v_evidence >= 3 and v_score < 50');
    expect(sql).not.toMatch(/daily[_ ]login/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all).*reputation_events.*authenticated/i);
  });

  it('uses only public.rides fields in the Ride status reputation trigger', async () => {
    const sql = await read('../../../database/sql/074_m1_fix_ride_reputation_status_trigger.sql');
    expect(sql).toContain('create or replace function private.reputation_from_ride_status()');
    expect(sql).toContain('coalesce(new.recruitment_closed_at, new.updated_at, now())');
    expect(sql).not.toContain('new.cancelled_at');
    expect(sql).not.toContain('new.cancelled_by');
  });

  it('exposes a privacy-filtered projection without private account fields', async () => {
    const sql = await read('../../../database/sql/073_m1_public_profile_visibility.sql');
    expect(sql).toMatch(/create table(?: if not exists)? public\.profile_visibility/i);
    expect(sql).toContain('create or replace function public.get_public_profile');
    expect(sql).toMatch(/grant execute on function public\.get_public_profile\(uuid\)\s+to anon, authenticated/i);
    expect(sql).toMatch(/case\s+when v_visibility\.show_profile_photo then v_profile\.profile_photo_url\s+else null\s+end/i);
    expect(sql).not.toMatch(/emergency_contact|profile_private|\bemail\b|\bphone\b/i);
  });

  it('applies confirmed conduct outcomes and safety holds through service-role-only functions', async () => {
    const sql = await read('../../../database/sql/078_m1_conduct_outcome_and_hold_reversal.sql');
    expect(sql).toContain('create or replace function private.apply_conduct_outcome(');
    expect(sql).toContain('create or replace function private.clear_reputation_hold(p_user_id uuid)');
    expect(sql).toContain('private.record_reputation_event(');
    expect(sql).toMatch(/'Safety'/);
    expect(sql).toContain("case p_event_type when 'confirmed_minor_conduct' then -8 else -20 end");
    expect(sql).toContain('set reputation_hold = true');
    expect(sql).toContain('set reputation_hold = false');
    expect(sql).not.toMatch(/grant\s+execute.*apply_conduct_outcome.*(anon|authenticated)/i);
    expect(sql).not.toMatch(/grant\s+execute.*clear_reputation_hold.*(anon|authenticated)/i);
  });

  // 104_m1 supersedes only apply_conduct_outcome's body (create or replace);
  // 078_m1's file and the two-value contract above are untouched history.
  it('escalates repeat confirmed conduct across four severity tiers instead of two', async () => {
    const sql = await read('../../../database/sql/104_m1_graduated_conduct_severity.sql');
    expect(sql).toContain("add constraint reputation_events_event_type_check check (event_type in (");
    expect(sql).toContain('confirmed_moderate_conduct');
    expect(sql).toContain('confirmed_severe_conduct');
    expect(sql).toContain('create or replace function private.apply_conduct_outcome(');
    expect(sql).toMatch(/when 'confirmed_minor_conduct' then -8/);
    expect(sql).toMatch(/when 'confirmed_moderate_conduct' then -14/);
    expect(sql).toMatch(/when 'confirmed_serious_conduct' then -20/);
    expect(sql).toContain('else -30');
    expect(sql).toContain("v_effective_type in ('confirmed_serious_conduct', 'confirmed_severe_conduct')");
    expect(sql).toMatch(/interval '90 days'/);
    expect(sql).toMatch(/interval '180 days'/);
    expect(sql).not.toMatch(/grant\s+execute.*apply_conduct_outcome.*(anon|authenticated)/i);
  });

  // 105_m1 is the one deliberate, manual exception to "identity documents do
  // not affect reputation" - it must stay admin-gated and must not touch the
  // identity review/approval path itself (093_m1/097_m1 own that).
  it('lets an admin manually flag and penalize identity verification left unresolved since signup', async () => {
    const sql = await read('../../../database/sql/105_m1_identity_overdue_penalty.sql');
    expect(sql).toContain('identity_verification_overdue');
    expect(sql).toContain('create or replace function public.admin_list_unverified_members()');
    expect(sql).toContain('create or replace function public.admin_apply_identity_overdue_penalty(');
    expect(sql).toMatch(/not exists\s*\(\s*select 1 from public\.identity_verifications/i);
    expect(sql).toContain('if not private.is_identity_review_admin() then');
    expect(sql).toContain("'M1', v_source_event_id, 'identity_verification_overdue',");
    expect(sql).toContain("'traveller', -5,");
    expect(sql).not.toMatch(/grant\s+execute.*admin_list_unverified_members.*(anon)\b/i);
    expect(sql).not.toMatch(/grant\s+execute.*admin_apply_identity_overdue_penalty.*(anon)\b/i);
  });

  // 106_m1 is the reviewer surface for confirming a Trust Case - it must stay
  // admin-gated and must never grant broader access than 097_m1 already
  // established, or widen 078_m1's own service-role-only functions.
  it('lets an admin look up a member, confirm a conduct outcome, and clear a hold - admin-gated throughout', async () => {
    const sql = await read('../../../database/sql/106_m1_admin_conduct_review.sql');
    expect(sql).toContain('create or replace function public.admin_get_reputation_summary(p_user_id uuid)');
    expect(sql).toContain('create or replace function public.admin_apply_conduct_outcome(');
    expect(sql).toContain('create or replace function public.admin_clear_reputation_hold(');
    expect(sql).toMatch(/if not private\.is_identity_review_admin\(\) then/g);
    expect(sql).toContain("where user_id = p_user_id and source_module = 'Safety'");
    expect(sql).toContain("v_source_event_id text := gen_random_uuid()::text");
    expect(sql).toContain("if coalesce(trim(p_reason), '') = '' then");
    expect(sql).toContain('return private.apply_conduct_outcome(p_user_id, p_event_type, v_source_event_id, p_reason, p_ride_id, p_set_hold);');
    expect(sql).toContain('perform private.clear_reputation_hold(p_user_id);');
    expect(sql).not.toMatch(/grant\s+execute.*admin_get_reputation_summary.*(anon)\b/i);
    expect(sql).not.toMatch(/grant\s+execute.*admin_apply_conduct_outcome.*(anon)\b/i);
    expect(sql).not.toMatch(/grant\s+execute.*admin_clear_reputation_hold.*(anon)\b/i);
  });

  // 107_m1 adds the self-service slice of the case queue 106_m1 explicitly
  // left out: a member-facing submit RPC plus admin-gated list/resolve RPCs.
  // Submission must stay self/other-only (no privileged target bypass);
  // listing and resolving must stay admin-gated exactly like 106_m1's own
  // functions, and resolving must never itself insert a reputation event -
  // that stays a separate, explicit admin_apply_conduct_outcome call.
  it('lets any signed-in member submit a safety report and only an admin list or resolve one', async () => {
    const sql = await read('../../../database/sql/107_m1_safety_report_queue.sql');
    expect(sql).toContain('create table public.safety_reports');
    expect(sql).toContain('constraint safety_reports_not_self check (reporter_id <> reported_user_id)');
    expect(sql).toMatch(/where status = 'open'/);
    expect(sql).toContain('create or replace function public.submit_safety_report(');
    expect(sql).toContain("raise exception 'You cannot report yourself'");
    expect(sql).toContain("raise exception 'A reason is required to report a member'");
    expect(sql).toContain('on conflict (reporter_id, reported_user_id) where status = \'open\' do nothing');
    expect(sql).toContain('create or replace function public.admin_list_safety_reports(');
    expect(sql).toContain('create or replace function public.admin_resolve_safety_report(');
    expect(sql).toMatch(/if not private\.is_identity_review_admin\(\) then/g);
    expect(sql).not.toMatch(/grant\s+execute.*admin_list_safety_reports.*(anon)\b/i);
    expect(sql).not.toMatch(/grant\s+execute.*admin_resolve_safety_report.*(anon)\b/i);
    // Resolving a report must never call apply_conduct_outcome/record_reputation_event
    // itself - that stays a separate, explicit reviewer action on the Trust Case form.
    const resolveFn = sql.slice(sql.indexOf('function public.admin_resolve_safety_report'));
    expect(resolveFn).not.toMatch(/apply_conduct_outcome|record_reputation_event/);
  });

  // 108_m1 fixes a live bug caught immediately after 107_m1 was deployed:
  // the derived table aliases created_at as "createdAt" (camelCase, to match
  // the JSON shape the client reads), but the outer ORDER BY referenced the
  // pre-alias name, which does not exist on that derived table - Postgres
  // raised "column r.created_at does not exist" every time the queue loaded.
  it('orders the safety report queue by the aliased column, not the pre-alias name', async () => {
    const sql = await read('../../../database/sql/108_m1_fix_safety_report_queue_order_by.sql');
    expect(sql).toContain('create or replace function public.admin_list_safety_reports(p_status text default \'open\')');
    expect(sql).toContain('r."createdAt" end asc');
    expect(sql).toContain('r."createdAt" end desc');
    expect(sql).not.toMatch(/end asc,?\s*\n?\s*r\.created_at/);
    expect(sql).not.toContain('r.created_at end');
    expect(sql).not.toMatch(/grant\s+execute.*admin_list_safety_reports.*(anon)\b/i);
  });
});
