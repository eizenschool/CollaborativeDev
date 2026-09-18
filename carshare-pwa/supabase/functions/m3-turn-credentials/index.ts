import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.110.8";
import {
  evaluateTurnGuard,
  normalizeCloudflareIceServers,
  stunOnlyConfiguration,
  TURN_CREDENTIAL_TTL_SECONDS,
  TURN_RATE_LIMIT_PER_HOUR,
} from "../_shared/m3Turn.ts";

type CredentialInput = { callId?: unknown };
type CallRow = {
  id: string;
  status: string;
  answered_at: string | null;
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(503, "SERVER_CONFIG", `${name} is not configured.`);
  }
  return value;
}

function runtimeKey(
  variable: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS",
) {
  const raw = Deno.env.get(variable);
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const value = parsed.default || Object.values(parsed)[0];
    if (value) return value;
  }
  return requiredEnv(
    variable === "SUPABASE_PUBLISHABLE_KEYS"
      ? "SUPABASE_ANON_KEY"
      : "SUPABASE_SERVICE_ROLE_KEY",
  );
}

function allowedOrigins() {
  return (Deno.env.get("M3_TURN_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  const trusted = origin && allowedOrigins().includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": trusted,
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  const allowed = allowedOrigins();
  if (!allowed.length) {
    throw new HttpError(
      503,
      "SERVER_CONFIG",
      "M3_TURN_ALLOWED_ORIGINS is not configured.",
    );
  }
  if (origin && !allowed.includes(origin)) {
    throw new HttpError(403, "UNTRUSTED_ORIGIN", "Untrusted browser origin.");
  }
}

function userClient(request: Request) {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    runtimeKey("SUPABASE_PUBLISHABLE_KEYS"),
    {
      global: {
        headers: { Authorization: request.headers.get("authorization") || "" },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function adminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    runtimeKey("SUPABASE_SECRET_KEYS"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function authenticatedUserId(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication required.");
  }
  return data.user.id;
}

function parseCallId(value: CredentialInput) {
  const callId = typeof value.callId === "string" ? value.callId.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(callId)
  ) {
    throw new HttpError(
      400,
      "INVALID_CALL",
      "A valid call identifier is required.",
    );
  }
  return callId;
}

async function activeParticipantCall(
  admin: SupabaseClient,
  callId: string,
  userId: string,
) {
  const { data, error } = await admin.from("call_sessions")
    .select("id, status, answered_at")
    .eq("id", callId)
    .maybeSingle();
  if (error) throw error;
  const call = data as CallRow | null;
  const { data: participant, error: participantError } = await admin
    .from("call_participants")
    .select("status")
    .eq("call_id", callId)
    .eq("user_id", userId)
    .maybeSingle();
  if (participantError) throw participantError;
  if (!call || !participant || !["ringing", "accepted"].includes(participant.status)) {
    throw new HttpError(403, "CALL_UNAVAILABLE", "This call is unavailable.");
  }
  const overlong = call.status === "accepted" && call.answered_at &&
    Date.now() - new Date(call.answered_at).getTime() >= 60 * 60 * 1000;
  if (!["ringing", "accepted"].includes(call.status) || overlong) {
    throw new HttpError(409, "CALL_INACTIVE", "This call is no longer active.");
  }
  return call;
}

async function guardDecision(admin: SupabaseClient) {
  const { data, error } = await admin.from("turn_usage_guard")
    .select(
      "period_start, egress_bytes, cutoff_bytes, automatic_blocked, manual_blocked, last_checked_at",
    )
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  return evaluateTurnGuard(data);
}

async function assertWithinRateLimit(admin: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin.from("turn_credential_issues")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("issued_at", since);
  if (error) throw error;
  if ((count || 0) >= TURN_RATE_LIMIT_PER_HOUR) {
    throw new HttpError(
      429,
      "TURN_RATE_LIMIT",
      "Too many relay credentials were requested. Try again later.",
    );
  }
}

async function generateCredential() {
  const keyId = requiredEnv("CLOUDFLARE_TURN_KEY_ID");
  const token = requiredEnv("CLOUDFLARE_TURN_API_TOKEN");
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${
      encodeURIComponent(keyId)
    }/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
    },
  );
  const payload = await response.json().catch(() => null) as {
    iceServers?: unknown;
  } | null;
  const iceServers = normalizeCloudflareIceServers(payload?.iceServers);
  const turnServer = iceServers.find((server) =>
    server.username && server.credential
  );
  if (response.status !== 201 || !turnServer?.username || !iceServers.length) {
    console.error("Cloudflare TURN credential request failed", response.status);
    throw new HttpError(
      503,
      "TURN_UNAVAILABLE",
      "The call relay is temporarily unavailable.",
    );
  }
  return { iceServers, username: turnServer.username };
}

async function revokeCredential(username: string) {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${
      encodeURIComponent(requiredEnv("CLOUDFLARE_TURN_KEY_ID"))
    }` +
      `/credentials/${encodeURIComponent(username)}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredEnv("CLOUDFLARE_TURN_API_TOKEN")}`,
      },
    },
  );
  if (response.status !== 204) {
    console.error(
      "Unable to revoke unrecorded TURN credential",
      response.status,
    );
  }
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST required.");
  }
  assertTrustedOrigin(request);

  const user = userClient(request);
  const userId = await authenticatedUserId(user);
  const callId = parseCallId(await request.json() as CredentialInput);
  const admin = adminClient();
  await activeParticipantCall(admin, callId, userId);
  const decision = await guardDecision(admin);
  if (!decision.relayAllowed) {
    return json(request, stunOnlyConfiguration(decision.reason));
  }
  await assertWithinRateLimit(admin, userId);

  const credential = await generateCredential();
  const expiresAt = new Date(Date.now() + TURN_CREDENTIAL_TTL_SECONDS * 1000)
    .toISOString();
  const { error } = await admin.rpc("record_turn_credential_issue", {
    p_call_id: callId,
    p_user_id: userId,
    p_turn_username: credential.username,
    p_expires_at: expiresAt,
  });
  if (error) {
    await revokeCredential(credential.username);
    if (/rate limit/i.test(error.message)) {
      throw new HttpError(
        429,
        "TURN_RATE_LIMIT",
        "Too many relay credentials were requested. Try again later.",
      );
    }
    throw error;
  }

  return json(request, {
    iceServers: credential.iceServers,
    relayAvailable: true,
    relayReason: "available",
    expiresAt,
  });
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        request,
        { error: error.message, code: error.code },
        error.status,
      );
    }
    console.error(error);
    return json(request, {
      error: "The call relay is temporarily unavailable.",
      code: "TURN_UNAVAILABLE",
    }, 500);
  }
});
