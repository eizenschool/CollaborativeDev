// ===== BUSINESS LOGIC LAYER (Tumpang Guide quota semantics) =====
// Only successful smart recommendation turns consume the 5/20 allowance.
// Clarifications, verified Help, emergency routing and deterministic fallbacks
// deliberately leave `used` unchanged.

export function guideQuotaState(usedTurns, limit) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const used = Math.max(0, Math.floor(Number(usedTurns) || 0));
  return {
    allowed: used < safeLimit,
    remaining: Math.max(0, safeLimit - used)
  };
}

export function afterSuccessfulGuideTurn(usedTurns, limit) {
  const current = guideQuotaState(usedTurns, limit);
  if (!current.allowed) return current;
  return {
    allowed: true,
    remaining: guideQuotaState(Number(usedTurns) + 1, limit).remaining
  };
}

export const GuideQuota = { guideQuotaState, afterSuccessfulGuideTurn };
