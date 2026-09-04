type Client = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> };

export function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export async function actorKey(userId: string | null, visitorSessionId: unknown, pepper: string) {
  if (userId) return `user:${userId}`;
  const visitor = String(visitorSessionId || "").slice(0, 160);
  if (visitor.length < 8) throw new Error("A guest session identifier is required.");
  const bytes = new TextEncoder().encode(`${pepper}:${visitor}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `guest:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function checkQuota(
  admin: Client, key: string, userId: string | null,
  { userLimit = 2_000_000_000, guestLimit = 5, globalLimit = 1000, burstLimit = 4,
    globalBurstLimit = 40, globalKey = "global:m6-tumpang-guide" } = {}
) {
  const dailyLimit = userId ? userLimit : guestLimit;
  const { data, error } = await admin.rpc("m6_guide_check_quota", {
    p_actor_key: key, p_user_id: userId, p_daily_limit: dailyLimit,
    p_burst_limit: burstLimit, p_global_key: globalKey,
    p_global_daily_limit: globalLimit, p_global_burst_limit: globalBurstLimit
  });
  if (error) throw new Error(error.message || "Guide quota check failed.");
  const row = Array.isArray(data) ? data[0] : data as Record<string, unknown> | null;
  return {
    allowed: Boolean(row?.allowed),
    remaining: Math.max(0, Number(row?.remaining) || 0),
    reason: typeof row?.reason === "string" ? row.reason : null,
    globalKey
  };
}

export async function recordProviderSuccess(admin: Client, key: string, globalKey: string) {
  const { error } = await admin.rpc("m6_guide_record_success", {
    p_actor_key: key, p_global_key: globalKey
  });
  if (error) throw new Error(error.message || "Guide usage could not be recorded.");
}

export async function persistSignedInTurn(admin: Client, payload: Record<string, unknown>) {
  const upgraded = await admin.rpc("m6_guide_persist_turn_v2", payload);
  if (!upgraded.error) return String(upgraded.data || "");
  // Keep the Edge deploy compatible while migration 080 rolls out. The
  // response still has a stable batch in the browser; only the legacy history
  // row lacks the new batch index until the additive migration is deployed.
  const legacyPayload = { ...payload };
  delete legacyPayload.p_batch_id;
  const legacy = await admin.rpc("m6_guide_persist_turn", legacyPayload);
  if (legacy.error) throw new Error(legacy.error.message || upgraded.error.message || "Guide history could not be saved.");
  return String(legacy.data || "");
}

export async function upgradeSignedInBatch(admin: Client, payload: Record<string, unknown>) {
  const upgraded = await admin.rpc("m6_guide_upgrade_batch", payload);
  if (upgraded.error) throw new Error(upgraded.error.message || "Guide batch could not be updated.");
  return Boolean(upgraded.data);
}

export async function persistGuestTrace(admin: Client, payload: Record<string, unknown>) {
  const { error } = await admin.rpc("m6_guide_record_guest_trace", payload);
  if (error) throw new Error(error.message || "Guide trace could not be saved.");
}
