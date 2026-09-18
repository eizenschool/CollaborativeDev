import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type SubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function corsHeaders(request: Request) {
  const allowedOrigin = Deno.env.get("NOTIFICATION_ALLOWED_ORIGIN") || "";
  const requestOrigin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : "null",
    // Supabase JS sends x-client-info on every browser request. Keep the
    // tracing/retry headers here too so a later SDK upgrade does not make the
    // preflight fail before the authenticated request reaches the function.
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function defaultKey(variable: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS") {
  const parsed = JSON.parse(Deno.env.get(variable) || "{}");
  return parsed.default || Object.values(parsed)[0];
}

async function currentUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const client = createClient(Deno.env.get("SUPABASE_URL") || "", defaultKey("SUPABASE_PUBLISHABLE_KEYS") as string, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required.");
  return data.user;
}

function validateSubscription(value: SubscriptionInput) {
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint : "";
  const p256dh = typeof value?.keys?.p256dh === "string" ? value.keys.p256dh : "";
  const auth = typeof value?.keys?.auth === "string" ? value.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new Error("Invalid push subscription.");
  const expirationTime = typeof value.expirationTime === "number" && Number.isFinite(value.expirationTime)
    ? new Date(value.expirationTime).toISOString()
    : null;
  return { endpoint, p256dh, auth, expirationTime };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, { error: "POST required" }, 405);
  try {
    const allowedOrigin = Deno.env.get("NOTIFICATION_ALLOWED_ORIGIN") || "";
    const requestOrigin = request.headers.get("origin") || "";
    if (!allowedOrigin || (requestOrigin && requestOrigin !== allowedOrigin)) {
      return response(request, { error: "Untrusted browser origin." }, 403);
    }
    const user = await currentUser(request);
    const input = await request.json() as { action?: string; subscription?: SubscriptionInput; endpoint?: unknown };
    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", defaultKey("SUPABASE_SECRET_KEYS") as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (input.action === "upsert") {
      const subscription = validateSubscription(input.subscription || {});
      const { error } = await admin.from("web_push_subscriptions").upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        expiration_time: subscription.expirationTime,
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return response(request, { ok: true });
    }
    if (input.action === "remove" && typeof input.endpoint === "string") {
      const { error } = await admin.from("web_push_subscriptions")
        .delete()
        .eq("endpoint", input.endpoint)
        .eq("user_id", user.id);
      if (error) throw error;
      return response(request, { ok: true });
    }
    return response(request, { error: "Unsupported subscription action." }, 400);
  } catch (error) {
    console.error(error);
    return response(request, { error: error instanceof Error ? error.message : "Notification subscription failed." }, 400);
  }
});
