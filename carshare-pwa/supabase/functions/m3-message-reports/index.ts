import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';

const BUCKET = 'message-report-evidence';
const url = Deno.env.get('SUPABASE_URL')!;
function key(modern: string, legacy: string) {
  const values = JSON.parse(Deno.env.get(modern) || '{}');
  return values.default || Object.values(values)[0] || Deno.env.get(legacy)!;
}
const admin = createClient(url, key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cleanup-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function checked({ data, error }: any) { if (error) throw new Error(error.message); return data; }

async function cleanup() {
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const expired = checked(await admin.from('message_report_evidence').select('id,snapshot').lt('resolved_at', cutoff).is('purged_at', null).limit(25));
  for (const row of expired) {
    const paths = (row.snapshot.attachments || []).map((_: unknown, i: number) => `${row.id}/${i}`);
    if (paths.length) checked(await admin.storage.from(BUCKET).remove(paths));
    checked(await admin.from('message_report_evidence').update({ snapshot: {}, purged_at: new Date().toISOString() }).eq('id', row.id));
  }
  const stale = checked(await admin.from('message_report_attempts').select('id,snapshot').lt('created_at', new Date(Date.now()-86400000).toISOString()).limit(100));
  for (const row of stale) {
    const evidence = checked(await admin.from('message_report_evidence').select('id').eq('id', row.id).maybeSingle());
    if (!evidence) {
      const paths = (row.snapshot.attachments || []).map((_: unknown, i: number) => `${row.id}/${i}`);
      if (paths.length) checked(await admin.storage.from(BUCKET).remove(paths));
    }
    checked(await admin.from('message_report_attempts').delete().eq('id', row.id));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  try {
    const body = await req.json();
    if (body.action === 'cleanup') {
      const allowed = checked(await admin.rpc('message_report_cleanup_authorized', { p_token: req.headers.get('x-cleanup-token') || '' }));
      if (!allowed) return Response.json({ error: 'Not authorized' }, { status: 403, headers });
      await cleanup();
      return Response.json({ ok: true }, { headers });
    }
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(url, key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: identity, error: authError } = await user.auth.getUser();
    if (authError || !identity.user) return Response.json({ error: 'Sign in to continue' }, { status: 401, headers });
    if (body.action === 'submit') {
      const prepared = checked(await user.rpc('prepare_message_report', { p_message_id: body.messageId, p_reason: body.reason }));
      if (prepared.alreadyReported) return Response.json({ ok: true }, { headers });
      // Paths come exclusively from the authorized SQL snapshot, never from the browser.
      if (!prepared.existingEvidenceId) {
        for (const [i, attachment] of prepared.snapshot.attachments.entries()) {
          checked(await admin.storage.from('message-media').copy(attachment.path, `${prepared.attemptId}/${i}`, { destinationBucket: BUCKET }));
        }
      }
      const result = checked(await admin.rpc('finish_message_report', { p_attempt_id: prepared.attemptId }));
      // Concurrent reporters may copy the same version. Only the winning copy is retained.
      if (!prepared.existingEvidenceId && result.evidenceId !== prepared.attemptId) {
        const paths = prepared.snapshot.attachments.map((_: unknown, i: number) => `${prepared.attemptId}/${i}`);
        if (paths.length) checked(await admin.storage.from(BUCKET).remove(paths));
      }
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === 'evidence') {
      const evidence = checked(await user.rpc('admin_message_report_evidence', { p_evidence_id: body.evidenceId }));
      const attachments = [];
      if (!evidence.purged) {
        for (const [i, attachment] of evidence.snapshot.attachments.entries()) {
          const signed = checked(await admin.storage.from(BUCKET).createSignedUrl(`${evidence.id}/${i}`, 300));
          attachments.push({ kind: attachment.kind, name: attachment.name, url: signed.signedUrl });
        }
      }
      return Response.json({ ...evidence, snapshot: { ...evidence.snapshot, attachments } }, { headers });
    }
    if (body.action === 'review') {
      const evidence = checked(await user.rpc('admin_message_report_evidence', { p_evidence_id: body.evidenceId }));
      checked(await user.rpc('admin_review_message_report', { p_evidence_id: body.evidenceId, p_outcome: body.outcome, p_reason: body.reason, p_remove: body.remove === true }));
      // Removal has committed. Delete only original objects no longer attached to a message.
      if (body.remove && body.outcome !== 'dismissed') {
        for (const attachment of evidence.snapshot.attachments || []) {
          const refs = checked(await admin.from('message_attachments').select('id').eq('storage_path', attachment.path).limit(1));
          if (!refs.length) await admin.storage.from('message-media').remove([attachment.path]);
        }
      }
      return Response.json({ ok: true }, { headers });
    }
    return Response.json({ error: 'Unknown action' }, { status: 400, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The report could not be processed' }, { status: 400, headers });
  }
});
