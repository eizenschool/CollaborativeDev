import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { env, supabaseSecretKey } from '../_shared/m2Routes.ts';
import { moderationCases } from '../_shared/m2ModerationCases.mjs';
import { checkText, POLICY_VERSION, TEXT_MODEL } from '../_shared/m2ContentPolicy.mjs';

// Optional, temporary evaluation endpoint. Uses existing server-only M3 secrets.
// Service credential only; never accepts user content or changes production gates.
// One case per request avoids Edge wall-clock limits. Delete after evaluation.
Deno.serve(async (request: Request) => {
  const keys = [supabaseSecretKey(), env('SUPABASE_SECRET_KEY')];
  try { keys.push(...Object.values(JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}')) as string[]); } catch { /* No configured named keys. */ }
  const authorized = keys.some((key) => typeof key === 'string' && key.length > 0
    && (request.headers.get('Authorization') === `Bearer ${key}` || request.headers.get('apikey') === key));
  if (request.method !== 'POST' || !authorized) return new Response(null, { status: 403 });
  let caseId;
  try { caseId = (await request.json()).caseId; } catch { return new Response(null, { status: 400 }); }
  const item = moderationCases.find((row) => row.id === caseId);
  if (!item) return Response.json({ caseIds: moderationCases.map((row) => row.id), policyVersion: POLICY_VERSION, model: TEXT_MODEL });
  const started = Date.now();
  let actual = 'unavailable';
  try {
    const verdict = await checkText({ accountId: env('M2_CLOUDFLARE_ACCOUNT_ID') || env('CLOUDFLARE_ACCOUNT_ID'), token: env('M2_CLOUDFLARE_API_TOKEN') || env('CLOUDFLARE_AI_TOKEN'), text: { [item.field]: item.text } });
    actual = verdict[item.field].status;
  } catch { /* Only a safe outcome leaves the server. */ }
  return Response.json({ id: item.id, language: item.language, expected: item.expected, actual, durationMs: Date.now()-started, policyVersion: POLICY_VERSION, model: TEXT_MODEL }, { headers: { 'Cache-Control': 'no-store' } });
});
