import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.110.8";
import { TURN_CUTOFF_BYTES, utcMonthStart } from "../_shared/m3Turn.ts";

type CredentialIssue = { id: string; turn_username: string };

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function secretRuntimeKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const value = parsed.default || Object.values(parsed)[0];
    if (value) return value;
  }
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function adminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), secretRuntimeKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function assertMonitorSecret(request: Request) {
  const expected = requiredEnv("M3_TURN_MONITOR_SECRET");
  const actual = request.headers.get("x-m3-turn-monitor-secret") || "";
  if (!actual || actual !== expected) throw new Error("UNAUTHORIZED_MONITOR");
}

async function monthlyEgressBytes(now = new Date()) {
  const dateFrom = utcMonthStart(now);
  const dateTo = now.toISOString().slice(0, 10);
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("CLOUDFLARE_ANALYTICS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        `query TurnUsage($accountId: String!, $dateFrom: Date!, $dateTo: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountId }) {
            callsTurnUsageAdaptiveGroups(
              limit: 10000
              filter: { date_geq: $dateFrom, date_leq: $dateTo }
            ) { sum { egressBytes } }
          }
        }
      }`,
      variables: {
        accountId: requiredEnv("CLOUDFLARE_ACCOUNT_ID"),
        dateFrom,
        dateTo,
      },
    }),
  });
  const payload = await response.json().catch(() => null) as {
    data?: {
      viewer?: {
        accounts?: Array<
          {
            callsTurnUsageAdaptiveGroups?: Array<
              { sum?: { egressBytes?: number } }
            >;
          }
        >;
      };
    };
    errors?: unknown[];
  } | null;
  if (!response.ok || payload?.errors?.length) {
    console.error(
      "Cloudflare TURN analytics request failed",
      response.status,
      JSON.stringify(payload?.errors || []),
    );
    throw new Error("TURN_ANALYTICS_UNAVAILABLE");
  }
  const groups =
    payload?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups || [];
  return groups.reduce(
    (total, group) => total + Number(group.sum?.egressBytes || 0),
    0,
  );
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
  return response.status === 204;
}

async function revokeActiveCredentials(admin: SupabaseClient, nowIso: string) {
  const { data, error } = await admin.from("turn_credential_issues")
    .select("id, turn_username")
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .limit(1000);
  if (error) throw error;
  const issues = (data || []) as CredentialIssue[];
  let revoked = 0;
  for (let offset = 0; offset < issues.length; offset += 20) {
    const batch = issues.slice(offset, offset + 20);
    const results = await Promise.all(batch.map(async (issue) => ({
      id: issue.id,
      ok: await revokeCredential(issue.turn_username).catch(() => false),
    })));
    const ids = results.filter((result) => result.ok).map((result) =>
      result.id
    );
    if (!ids.length) continue;
    const { error: updateError } = await admin.from("turn_credential_issues")
      .update({ revoked_at: nowIso })
      .in("id", ids);
    if (updateError) throw updateError;
    revoked += ids.length;
  }
  return revoked;
}

Deno.serve(async (request) => {
  let admin: SupabaseClient | null = null;
  try {
    if (request.method !== "POST") {
      return Response.json({ error: "POST required." }, { status: 405 });
    }
    assertMonitorSecret(request);
    admin = adminClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const periodStart = utcMonthStart(now);
    const egressBytes = await monthlyEgressBytes(now);
    const blocked = egressBytes >= TURN_CUTOFF_BYTES;
    const { error: guardError } = await admin.from("turn_usage_guard").upsert({
      singleton: true,
      period_start: periodStart,
      egress_bytes: egressBytes,
      cutoff_bytes: TURN_CUTOFF_BYTES,
      automatic_blocked: blocked,
      last_checked_at: nowIso,
      last_error_at: null,
      updated_at: nowIso,
    }, { onConflict: "singleton" });
    if (guardError) throw guardError;

    const { error: expiryError } = await admin.rpc(
      "expire_overlong_voice_calls",
    );
    if (expiryError) throw expiryError;
    const revoked = blocked ? await revokeActiveCredentials(admin, nowIso) : 0;
    return Response.json({
      ok: true,
      periodStart,
      egressBytes,
      blocked,
      revoked,
    });
  } catch (error) {
    if (admin) {
      try {
        const failedAt = new Date().toISOString();
        await admin.from("turn_usage_guard")
          .update({ last_error_at: failedAt, updated_at: failedAt })
          .eq("singleton", true);
      } catch {
        // The original monitoring failure is more useful than a secondary audit failure.
      }
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED_MONITOR") {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    console.error(error);
    return Response.json({ error: "TURN usage monitoring failed." }, {
      status: 503,
    });
  }
});
