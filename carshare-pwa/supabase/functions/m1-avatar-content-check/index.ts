// Module 1: checks a profile photo for sensitive content (an accidentally
// uploaded identity document, visible personal information, or unsafe
// content) before ProfileService.updateProfilePhoto() ever puts it in the
// public `avatars` bucket. Unlike identity documents (private bucket,
// admin-reviewed), an avatar has no reviewer and is public the instant it
// uploads - this is the one gate it gets.
//
// Uses Sightengine alone (sightengineCheck.ts) - see docs/ai/DECISIONS.md
// D039 for the full provider history: Gemini (dropped after three separate
// live issues in one session), then Google Cloud Vision (fully built and
// tested but never deployable live - blocked by a Google Cloud
// billing-account "payment anomaly" that affects even its free tier).
// Sightengine's request/response contract was confirmed against real live
// `check.json` calls before switching, and its `offensive-2.0` model covers
// `offensive_gesture` (a raised middle finger) live, closing a gap Vision's
// SafeSearch had no equivalent for.
// This intentionally does not touch supabase/functions/m6-tumpang-guide -
// Module 6's own Gemini usage is a separate, unrelated feature.
//
// Fail-open is a business-logic decision, not this function's: on any error
// here (Sightengine down, rate-limited, timed out, or credentials not
// configured) this returns a normal HTTP error, and
// src/business-logic/m1-profile/ProfileService.js decides to let the
// upload through anyway rather than block someone from setting a photo
// because a third-party API hiccupped.
//
// Requires an authenticated caller so this cannot be used as a free,
// unauthenticated Sightengine proxy - same posture as
// m3-message-translation/index.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { checkImageWithSightengine } from "./sightengineCheck.ts";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Matches ProfileService.js's 5 MB file-size cap, with slack for base64's
// ~4/3 expansion - this rejects an oversized payload before it reaches
// Sightengine, not just at the original file-size check the client already ran.
const MAX_BASE64_LENGTH = 7 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(503, "SERVER_CONFIG", `${name} is not configured.`);
  return value;
}

function defaultRuntimeKey(variable: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS") {
  const raw = Deno.env.get(variable);
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const value = parsed.default || Object.values(parsed)[0];
    if (value) return value;
  }
  const legacyName = variable === "SUPABASE_PUBLISHABLE_KEYS" ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY";
  return requiredEnv(legacyName);
}

function allowedOrigins() {
  return (Deno.env.get("M1_AVATAR_CHECK_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  const allowed = allowedOrigins();
  const trustedOrigin = origin && allowed.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": trustedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  const allowed = allowedOrigins();
  if (!allowed.length) throw new HttpError(503, "SERVER_CONFIG", "M1_AVATAR_CHECK_ALLOWED_ORIGINS is not configured.");
  if (origin && !allowed.includes(origin)) throw new HttpError(403, "UNTRUSTED_ORIGIN", "Untrusted browser origin.");
}

function userClient(request: Request) {
  return createClient(requiredEnv("SUPABASE_URL"), defaultRuntimeKey("SUPABASE_PUBLISHABLE_KEYS"), {
    global: { headers: { Authorization: request.headers.get("authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type CheckInput = { image?: unknown; mimeType?: unknown };

function parseInput(value: CheckInput) {
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new HttpError(400, "UNSUPPORTED_TYPE", "Use a JPEG, PNG, or WebP image.");
  }
  const image = typeof value.image === "string" ? value.image : "";
  if (!image) throw new HttpError(400, "MISSING_IMAGE", "An image is required.");
  if (image.length > MAX_BASE64_LENGTH) throw new HttpError(400, "IMAGE_TOO_LARGE", "Profile picture must be 5 MB or smaller.");
  return { image, mimeType };
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "POST required.");
  assertTrustedOrigin(request);

  const client = userClient(request);
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw new HttpError(401, "AUTH_REQUIRED", "Authentication required.");

  let input: CheckInput;
  try {
    input = await request.json() as CheckInput;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const { image, mimeType } = parseInput(input);

  const apiUser = Deno.env.get("SIGHTENGINE_API_USER")?.trim() || "";
  const apiSecret = Deno.env.get("SIGHTENGINE_API_SECRET")?.trim() || "";
  if (!apiUser || !apiSecret) throw new HttpError(503, "SERVER_CONFIG", "SIGHTENGINE_API_USER/SIGHTENGINE_API_SECRET are not configured.");

  try {
    const result = await checkImageWithSightengine({ apiUser, apiSecret, imageBase64: image, mimeType });
    return json(request, result);
  } catch (error) {
    console.error("Avatar content check failed", error instanceof Error ? error.message : error);
    throw new HttpError(503, "CHECK_UNAVAILABLE", "The photo content check is temporarily unavailable.");
  }
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof HttpError) return json(request, { error: error.message, code: error.code }, error.status);
    console.error(error);
    return json(request, { error: "The photo content check is temporarily unavailable.", code: "CHECK_FAILED" }, 500);
  }
});
