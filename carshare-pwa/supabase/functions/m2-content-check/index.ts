import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { authenticatedUserId, env, HttpError, json, rpc, supabaseSecretKey } from "../_shared/m2Routes.ts";
import { checkText, digest, normalizeText, POLICY_VERSION, validImageBytes } from "../_shared/m2ContentPolicy.mjs";
import { checkImageWithSightengine } from "../_shared/sightengineCheck.ts";

const BUCKET = 'ride-pickup-photos';
const approved = () => ({ status: 'approved', reasons: [] });
const unavailable = () => ({ status: 'unavailable', reasons: ['check_unavailable'] });
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return json(request, {});
  const started = Date.now();
  let field = 'pickupPhoto';
  let outcome = 'unavailable';
  let reasonCodes: string[] = [];
  const reply = (body: Record<string, any>, status = 200) => {
    const fields = Object.values(body.fields || {}) as { status: string; reasons: string[] }[];
    outcome = fields.some((row) => row.status === 'rejected') ? 'rejected' : status >= 400 ? 'unavailable' : 'approved';
    reasonCodes = [...new Set([...reasonCodes, ...fields.flatMap((row) => row.reasons || [])])];
    return json(request, body, status);
  };
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'POST required');
    const origins = env('M2_ALLOWED_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origins.length || (request.headers.get('origin') && !origins.includes(request.headers.get('origin')!))) {
      throw new HttpError(403, 'UNTRUSTED_ORIGIN', 'Untrusted origin');
    }
    const userId = await authenticatedUserId(request);
    // Bounded streaming read: do not allocate an unbounded base64 request.
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'INVALID_INPUT', 'Request body required');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 2900000) { await reader.cancel(); throw new HttpError(413, 'IMAGE_TOO_LARGE', 'Prepared photo must be 2 MB or smaller'); }
      chunks.push(part.value);
    }
    const input = JSON.parse(await new Blob(chunks.map((chunk) => new Uint8Array(chunk).buffer)).text());
    field = input.action === 'check' ? 'text' : 'pickupPhoto';
    if (!UUID.test(input.rideId || '') || !['check','photo','remove_draft_photo'].includes(input.action)) throw new HttpError(400, 'INVALID_INPUT', 'Invalid moderation request');
    const admin = createClient(env('SUPABASE_URL'), supabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ride, error } = await admin.from('rides').select('id,host_id,status,updated_at,pickup_photo_path').eq('id', input.rideId).single();
    if (error || !ride || ride.host_id !== userId) throw new HttpError(403, 'RIDE_ACCESS', 'Only the Host can change this Ride');
    const { count, error: requestError } = await admin.from('ride_requests').select('id', { head: true, count: 'exact' }).eq('ride_id', ride.id).eq('status','Accepted');
    if (requestError || count || !['Draft','Published'].includes(ride.status)) throw new HttpError(409, 'RIDE_LOCKED', 'This Ride can no longer be edited');
    if (input.action === 'remove_draft_photo') {
      await rpc('bind_m2_draft_photo', { p_host_id: userId, p_ride_id: ride.id, p_path: null });
      return reply({ fields: { pickupPhoto: approved() }, path: null });
    }
    await rpc('consume_m2_content_quota', { p_host_id: userId });
    if (input.action === 'photo') {
      if (env('M2_PHOTO_MODERATION_ENABLED') !== 'true') throw new Error('CHECK_UNAVAILABLE');
      const binary = atob(input.image || '');
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      if (!validImageBytes(bytes, input.mimeType)) throw new HttpError(400, 'INVALID_IMAGE', 'Use a valid JPEG, PNG or WebP photo up to 2 MB');
      const bytesDigest = await digest(bytes);
      const { data: cached } = await admin.from('m2_moderated_photos').select('path').eq('ride_id', ride.id).eq('host_id', userId)
        .eq('digest', bytesDigest).eq('policy_version', POLICY_VERSION).eq('retiring', false).gt('created_at', new Date(Date.now()-86400000).toISOString()).limit(1);
      if (cached?.length) {
        if (input.attachDraft === true) await rpc('bind_m2_draft_photo', { p_host_id: userId, p_ride_id: ride.id, p_path: cached[0].path });
        return reply({ path: cached[0].path, fields: { pickupPhoto: approved() } });
      }
      const verdict = await checkImageWithSightengine({ apiUser: env('SIGHTENGINE_API_USER'), apiSecret: env('SIGHTENGINE_API_SECRET'), imageBase64: input.image, mimeType: input.mimeType, strict: true });
      if (verdict.flagged) return reply({ fields: { pickupPhoto: { status: 'rejected', reasons: verdict.categories } } });
      const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType === 'image/png' ? 'png' : 'webp';
      const path = `${userId}/${ride.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: input.mimeType, upsert: false });
      if (uploadError) throw new Error('UPLOAD_UNAVAILABLE');
      try {
        const { error: insertError } = await admin.from('m2_moderated_photos').insert({ path, ride_id: ride.id, host_id: userId, digest: bytesDigest, policy_version: POLICY_VERSION });
        if (insertError) throw new Error('CHECK_UNAVAILABLE');
        if (input.attachDraft === true) await rpc('bind_m2_draft_photo', { p_host_id: userId, p_ride_id: ride.id, p_path: path });
      } catch (cause) {
        await admin.storage.from(BUCKET).remove([path]);
        await admin.from('m2_moderated_photos').delete().eq('path', path);
        throw cause;
      }
      return reply({ path, fields: { pickupPhoto: approved() } });
    }
    if (env('M2_TEXT_MODERATION_ENABLED') !== 'true' || env('M2_TEXT_EVALUATED_POLICY') !== POLICY_VERSION) throw new Error('CHECK_UNAVAILABLE');
    const text = normalizeText(input.text || {});
    const photoPath = input.photoPath === undefined ? ride.pickup_photo_path : input.photoPath;
    if (photoPath !== null && typeof photoPath !== 'string') throw new HttpError(400, 'INVALID_PHOTO', 'Invalid photo');
    if (photoPath) {
      field = 'pickupPhoto';
      const { data: asset } = await admin.from('m2_moderated_photos').select('path').eq('path', photoPath).eq('ride_id', ride.id).eq('host_id', userId).eq('policy_version', POLICY_VERSION).eq('retiring', false).maybeSingle();
      if (!asset) {
        // Legacy attached photo: recheck actual stored bytes before first edit.
        if (photoPath !== ride.pickup_photo_path || env('M2_PHOTO_MODERATION_ENABLED') !== 'true') throw new Error('PHOTO_APPROVAL_REQUIRED');
        const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(photoPath);
        if (downloadError || !blob) throw new Error('PHOTO_APPROVAL_REQUIRED');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!validImageBytes(bytes, blob.type)) throw new Error('PHOTO_APPROVAL_REQUIRED');
        let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
        const verdict = await checkImageWithSightengine({ apiUser: env('SIGHTENGINE_API_USER'), apiSecret: env('SIGHTENGINE_API_SECRET'), imageBase64: btoa(binary), mimeType: blob.type, strict: true });
        if (verdict.flagged) return reply({ fields: { pickupPhoto: { status: 'rejected', reasons: verdict.categories } } });
        const { error: insertError } = await admin.from('m2_moderated_photos').upsert({ path: photoPath, ride_id: ride.id, host_id: userId, digest: await digest(bytes), policy_version: POLICY_VERSION });
        if (insertError) throw new Error('CHECK_UNAVAILABLE');
      }
    }
    field = 'text';
    const hashes = { contribution_digest: await digest(text.contribution), instructions_digest: await digest(text.pickupInstructions) };
    const { data: previous } = await admin.from('m2_content_approvals').select('id').eq('ride_id', ride.id).eq('host_id', userId)
      .eq('contribution_digest', hashes.contribution_digest).eq('instructions_digest', hashes.instructions_digest)
      .eq('policy_version', POLICY_VERSION).gt('expires_at', new Date().toISOString()).limit(1);
    const fields = previous?.length ? { contribution: approved(), pickupInstructions: approved() }
      : await checkText({ accountId: env('M2_CLOUDFLARE_ACCOUNT_ID') || env('CLOUDFLARE_ACCOUNT_ID'), token: env('M2_CLOUDFLARE_API_TOKEN') || env('CLOUDFLARE_AI_TOKEN'), text });
    if (Object.values(fields).some((row: any) => row.status !== 'approved')) return reply({ fields });
    const { data: receipt, error: receiptError } = await admin.from('m2_content_approvals').insert({ ride_id: ride.id, host_id: userId, ...hashes, photo_path: photoPath, base_updated_at: ride.updated_at, policy_version: POLICY_VERSION }).select('id,expires_at').single();
    if (receiptError) throw new Error('CHECK_UNAVAILABLE');
    return reply({ approvalId: receipt.id, expiresAt: receipt.expires_at, fields: { ...fields, pickupPhoto: approved() } });
  } catch (error) {
    if (error instanceof HttpError && error.status < 500 && !error.message.includes('CONTENT_CHECK_RATE_LIMIT')) return reply({ error: error.message, code: error.code }, error.status);
    reasonCodes = [error instanceof Error && /QUOTA|RATE_LIMIT/.test(error.message) ? 'quota' : 'provider_unavailable'];
    return reply({ code: 'CHECK_UNAVAILABLE', fields: field === 'text' ? { contribution: unavailable(), pickupInstructions: unavailable() } : { pickupPhoto: unavailable() } }, 503);
  } finally {
    console.info(JSON.stringify({ event: 'm2_content_check', durationMs: Date.now() - started, outcome, reasonCodes }));
  }
});
