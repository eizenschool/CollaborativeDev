import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function namedKey(name: "SUPABASE_SECRET_KEYS" | "SUPABASE_PUBLISHABLE_KEYS") {
  try {
    const parsed = JSON.parse(Deno.env.get(name) || "{}");
    return parsed.default || Object.values(parsed)[0] || "";
  } catch { return ""; }
}

function cors(request: Request) {
  const configured = (Deno.env.get("M2_ALLOWED_ORIGIN") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": configured.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function reply(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: cors(request) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return reply(request, { error: "POST required" }, 405);
  const allowed = (Deno.env.get("M2_ALLOWED_ORIGIN") || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(request.headers.get("origin") || "")) return reply(request, { error: "Pickup photo unavailable." }, 404);

  try {
    const input = await request.json() as { rideId?: unknown };
    const rideId = typeof input.rideId === "string" ? input.rideId : "";
    if (!UUID.test(rideId)) return reply(request, { error: "Pickup photo unavailable." }, 404);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const secret = namedKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const publicKey = namedKey("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

    let viewerId = "";
    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ") && publicKey) {
      const authClient = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await authClient.auth.getUser(authorization.slice(7));
      viewerId = data.user?.id || "";
    }

    const { data: ride, error } = await admin.from("rides")
      .select("id, host_id, status, pickup_photo_path, host:profiles!rides_host_id_fkey(status)")
      .eq("id", rideId).maybeSingle();
    if (error || !ride?.pickup_photo_path) return reply(request, { error: "Pickup photo unavailable." }, 404);

    const host = Array.isArray(ride.host) ? ride.host[0] : ride.host;
    let allowedViewer = ride.status === "Published" && host?.status === "active";
    if (!allowedViewer && viewerId) {
      allowedViewer = ride.host_id === viewerId;
      if (!allowedViewer) {
        const { data: accepted } = await admin.from("ride_requests").select("id")
          .eq("ride_id", rideId).eq("requester_id", viewerId).eq("status", "Accepted").maybeSingle();
        allowedViewer = Boolean(accepted);
      }
    }
    if (!allowedViewer) return reply(request, { error: "Pickup photo unavailable." }, 404);

    const { data: signed, error: signError } = await admin.storage.from("ride-pickup-photos")
      .createSignedUrl(ride.pickup_photo_path, 300);
    if (signError || !signed?.signedUrl) return reply(request, { error: "Pickup photo unavailable." }, 404);
    return reply(request, { signedUrl: signed.signedUrl, expiresIn: 300 });
  } catch {
    return reply(request, { error: "Pickup photo unavailable." }, 404);
  }
});
