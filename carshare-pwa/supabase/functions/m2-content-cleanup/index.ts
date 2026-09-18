import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { env, supabaseSecretKey } from '../_shared/m2Routes.ts';

// Called by a server schedule only. No browser or user JWT access.
Deno.serve(async (request: Request) => {
  const secret = env('M2_CONTENT_CLEANUP_SECRET');
  if (request.method !== 'POST' || !secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return new Response(null, { status: 403 });
  const admin = createClient(env('SUPABASE_URL'), supabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('claim_m2_unused_photos');
  if (error) return new Response(null, { status: 503 });
  let removed = 0;
  for (let offset = 0; offset < (data || []).length; offset += 100) {
    const paths = data.slice(offset, offset + 100).map((row: { path: string }) => row.path);
    const { error: storageError } = await admin.storage.from('ride-pickup-photos').remove(paths);
    if (storageError) return new Response(null, { status: 503 });
    const { error: deleteError } = await admin.from('m2_moderated_photos').delete().in('path', paths).eq('retiring', true);
    if (deleteError) return new Response(null, { status: 503 });
    removed += paths.length;
  }
  return Response.json({ removed });
});
