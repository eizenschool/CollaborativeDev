import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type AdminClient = SupabaseClient;

export type TurnLease = { enabled: boolean; actorKey: string; clientTurnId: string; leaseToken: string };

export async function claimGuideTurn(admin: AdminClient, actorKey: string, clientTurnId: string, traceId: string) {
  const leaseToken = crypto.randomUUID();
  const { data, error } = await admin.rpc("m6_claim_ai_guide_turn", {
    p_actor_key: actorKey, p_client_turn_id: clientTurnId, p_lease_token: leaseToken,
    p_trace_id: traceId, p_lease_seconds: 100
  });
  if (error) return { state: "unavailable", lease: { enabled: false, actorKey, clientTurnId, leaseToken } as TurnLease };
  const row = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return { ...row, lease: { enabled: row.state === "claimed", actorKey, clientTurnId, leaseToken } as TurnLease };
}

export async function completeGuideTurn(admin: AdminClient, lease: TurnLease, response: unknown) {
  if (!lease.enabled) return;
  await admin.rpc("m6_complete_ai_guide_turn", {
    p_actor_key: lease.actorKey, p_client_turn_id: lease.clientTurnId,
    p_lease_token: lease.leaseToken, p_response_payload: response
  });
}

export async function failGuideTurn(admin: AdminClient, lease: TurnLease) {
  if (!lease.enabled) return;
  await admin.rpc("m6_fail_ai_guide_turn", {
    p_actor_key: lease.actorKey, p_client_turn_id: lease.clientTurnId, p_lease_token: lease.leaseToken
  });
}

export async function providerInCooldown(admin: AdminClient, provider: "gemini" | "groq") {
  try {
    const { data } = await admin.schema("private").from("ai_guide_provider_health")
      .select("cooldown_until,last_http_status").eq("provider", provider).maybeSingle();
    const health = data as Record<string, unknown> | null;
    // A 400 is a request-contract problem, not evidence that the provider is
    // globally unavailable. Do not let an old malformed request quarantine a
    // provider for every user after the request contract has been fixed.
    if (Number(health?.last_http_status) === 400) return false;
    const until = Date.parse(String(health?.cooldown_until || ""));
    return Number.isFinite(until) && until > Date.now();
  } catch { return false; }
}

export async function recordProviderAttempt(admin: AdminClient, value: {
  traceId: string; clientTurnId?: string; provider: "gemini" | "groq"; model: string;
  stage: string; outcome: "success" | "failure" | "skipped"; status?: number; latencyMs: number; reason?: string;
  retryAfterSeconds?: number;
}) {
  try {
    await admin.schema("private").from("ai_guide_provider_attempts").insert({
      trace_id: value.traceId, client_turn_id: value.clientTurnId || null, provider: value.provider,
      model: value.model, stage: value.stage, outcome: value.outcome,
      http_status: value.status || null, latency_ms: Math.max(0, Math.round(value.latencyMs)),
      failure_reason: value.reason ? String(value.reason).slice(0, 160) : null
    });
    if (value.outcome === "success") {
      await admin.schema("private").from("ai_guide_provider_health").upsert({
        provider: value.provider, cooldown_until: null, last_http_status: null,
        last_failure_reason: null, retry_after_seconds: null, updated_at: new Date().toISOString()
      }, { onConflict: "provider" });
    } else if (value.outcome === "failure" && [401, 403, 404, 429].includes(Number(value.status))) {
      const seconds = Number(value.status) === 429
        ? Math.max(1, Math.min(3600, Number(value.retryAfterSeconds) || 60)) : 300;
      await admin.schema("private").from("ai_guide_provider_health").upsert({
        provider: value.provider, cooldown_until: new Date(Date.now() + seconds * 1000).toISOString(),
        last_http_status: value.status || null, last_failure_reason: String(value.reason || "provider_failure").slice(0, 160),
        retry_after_seconds: seconds, updated_at: new Date().toISOString()
      }, { onConflict: "provider" });
    }
  } catch { /* Reliability audit must not break a useful turn during rollout. */ }
}
