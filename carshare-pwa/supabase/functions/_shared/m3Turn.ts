export const TURN_CUTOFF_BYTES = 900_000_000_000;
export const TURN_CREDENTIAL_TTL_SECONDS = 75 * 60;
export const TURN_MONITOR_STALE_MS = 15 * 60 * 1000;
export const TURN_RATE_LIMIT_PER_HOUR = 10;
export const TURN_STUN_URLS = ["stun:stun.cloudflare.com:3478"];

export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export type TurnGuardRow = {
  period_start?: unknown;
  egress_bytes?: unknown;
  cutoff_bytes?: unknown;
  automatic_blocked?: unknown;
  manual_blocked?: unknown;
  last_checked_at?: unknown;
};

export type TurnGuardDecision = {
  relayAllowed: boolean;
  reason:
    | "available"
    | "manual_block"
    | "monthly_limit"
    | "monitor_uninitialized"
    | "monitor_stale";
};

export function utcMonthStart(now = new Date()): string {
  return `${now.getUTCFullYear()}-${
    String(now.getUTCMonth() + 1).padStart(2, "0")
  }-01`;
}

export function evaluateTurnGuard(
  row: TurnGuardRow | null | undefined,
  now = new Date(),
): TurnGuardDecision {
  if (!row?.last_checked_at) {
    return { relayAllowed: false, reason: "monitor_uninitialized" };
  }
  if (row.period_start !== utcMonthStart(now)) {
    return { relayAllowed: false, reason: "monitor_stale" };
  }
  const lastCheckedAt = Date.parse(String(row.last_checked_at));
  if (
    !Number.isFinite(lastCheckedAt) ||
    now.getTime() - lastCheckedAt > TURN_MONITOR_STALE_MS
  ) {
    return { relayAllowed: false, reason: "monitor_stale" };
  }
  if (row.manual_blocked === true) {
    return { relayAllowed: false, reason: "manual_block" };
  }
  const egressBytes = Number(row.egress_bytes);
  const cutoffBytes = Number(row.cutoff_bytes || TURN_CUTOFF_BYTES);
  if (
    row.automatic_blocked === true || !Number.isFinite(egressBytes) ||
    !Number.isFinite(cutoffBytes) || egressBytes >= cutoffBytes
  ) {
    return { relayAllowed: false, reason: "monthly_limit" };
  }
  return { relayAllowed: true, reason: "available" };
}

function validUrl(value: unknown): value is string {
  return typeof value === "string" && /^(stun|turn|turns):/i.test(value);
}

function browserSafeUrl(value: string): boolean {
  return !/:53(?:\?|$)/i.test(value);
}

export function normalizeCloudflareIceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as {
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
    };
    const urls = (Array.isArray(raw.urls) ? raw.urls : [raw.urls])
      .filter(validUrl)
      .filter(browserSafeUrl);
    if (!urls.length) return [];
    const hasTurn = urls.some((url) => /^turns?:/i.test(url));
    if (
      hasTurn &&
      (typeof raw.username !== "string" || typeof raw.credential !== "string")
    ) {
      return [];
    }
    return [{
      urls,
      ...(hasTurn
        ? {
          username: raw.username as string,
          credential: raw.credential as string,
        }
        : {}),
    }];
  });
}

export function stunOnlyConfiguration(
  reason: TurnGuardDecision["reason"] | "relay_unavailable",
) {
  return {
    iceServers: [{ urls: TURN_STUN_URLS }],
    relayAvailable: false,
    relayReason: reason,
    expiresAt: null,
  };
}
