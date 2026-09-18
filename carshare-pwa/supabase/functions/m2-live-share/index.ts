import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function key(name: "SUPABASE_SECRET_KEYS" | "SUPABASE_PUBLISHABLE_KEYS") {
  try {
    const parsed = JSON.parse(Deno.env.get(name) || "{}");
    return parsed.default || Object.values(parsed)[0] || "";
  } catch { return ""; }
}

function cors(request: Request) {
  const configured = Deno.env.get("M2_ALLOWED_ORIGIN") || "";
  const origin = request.headers.get("origin") || "";
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function reply(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: cors(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return reply(request, { error: "POST required" }, 405);
  const configured = Deno.env.get("M2_ALLOWED_ORIGIN") || "";
  const origin = request.headers.get("origin") || "";
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return reply(request, { error: "Untrusted browser origin." }, 403);
  try {
    const input = await request.json() as { token?: unknown; action?: unknown; pageSessionId?: unknown };
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (token.length < 40 || token.length > 100) return reply(request, { error: "This family link is invalid or expired." }, 404);
    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", key("SUPABASE_SECRET_KEYS"), { auth: { persistSession: false, autoRefreshToken: false } });
    if (input.action === "map-permit" && typeof input.pageSessionId === "string") {
      const { data, error } = await admin.rpc("consume_m2_family_map_load", { p_token: token, p_page_session_id: input.pageSessionId });
      if (error) throw error;
      return reply(request, { allowed: data === true });
    }
    const { data, error } = await admin.rpc("get_m2_family_location_snapshot", { p_token: token });
    if (error) throw error;
    const snapshot = data as { status?: unknown; locations?: unknown } | null;
    if (!snapshot || snapshot.status === "invalid") {
      return reply(request, { error: "This family link is invalid or expired." }, 404);
    }
    const status = ["scheduled", "waiting", "active"].includes(String(snapshot.status))
      ? String(snapshot.status)
      : "waiting";
    return reply(request, {
      status,
      locations: Array.isArray(snapshot.locations) ? snapshot.locations : [],
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Family share failed");
    return reply(request, { error: "This family link is invalid or expired." }, 404);
  }
});
