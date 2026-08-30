// ===== BUSINESS LOGIC LAYER (Tumpang Guide validation policy) =====
import {
  GUIDE_ACTION, GUIDE_LANGUAGES, GUIDE_LIMITS, GUIDE_MODE, GUIDE_REASON, GUIDE_ROLE, GUIDE_TRADEOFF
} from './constants.js';

const MODES = new Set(Object.values(GUIDE_MODE));
const ROLES = new Set(Object.values(GUIDE_ROLE));
const REASONS = new Set(Object.values(GUIDE_REASON));
const TRADEOFFS = new Set(Object.values(GUIDE_TRADEOFF));
const ACTIONS = new Set(Object.values(GUIDE_ACTION));

const EMERGENCY_TERMS = [
  /\b(?:emergency|danger|unsafe|attack|accident|help me|call police|ambulance|sos)\b/i,
  /紧急|危險|危险|求救|救命|报警|報警|救护车|救護車/u,
  /\b(?:kecemasan|bahaya|kemalangan|tolong saya|polis|ambulans)\b/i,
  /அவசரம்|ஆபத்து|விபத்து|உதவி|காவல்|ஆம்புலன்ஸ்/u
];

const HELP_TERMS = [
  /\b(?:how (?:do|can|to)|where (?:is|can)|help with|use the app|favourite|ride alert|profile preference)\b/i,
  /怎么|如何|在哪|使用.*(?:应用|應用)|收藏|通知/u,
  /\b(?:bagaimana|cara|di mana|guna aplikasi|kegemaran|amaran ride)\b/i,
  /எப்படி|எங்கே|செயலியை|விருப்பம்|அறிவிப்பு/u
];

export function isEmergencyIntent(text) {
  return EMERGENCY_TERMS.some((pattern) => pattern.test(String(text || '')));
}

export function isGuideHelpIntent(text) {
  return HELP_TERMS.some((pattern) => pattern.test(String(text || '')));
}

export function safeRecentMessages(messages = []) {
  return messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-GUIDE_LIMITS.CONTEXT_TURNS * 2)
    .map((message) => ({ role: message.role, text: String(message.text || '').slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS) }));
}

export function validateGuideResponse(raw, allowedPlaceIds = [], { expectedRecommendations = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, reason: 'invalid_json_shape' };
  if (!MODES.has(raw.mode)) return { valid: false, reason: 'unknown_mode' };
  if (!GUIDE_LANGUAGES.includes(raw.language) && !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(raw.language || ''))) return { valid: false, reason: 'unknown_language' };
  if (typeof raw.assistantMessage !== 'string' || !raw.assistantMessage.trim()) return { valid: false, reason: 'missing_message' };
  if (!Array.isArray(raw.quickReplies) || !Array.isArray(raw.recommendations) || !Array.isArray(raw.actions)) {
    return { valid: false, reason: 'invalid_collections' };
  }
  if (raw.recommendations.length > GUIDE_LIMITS.MAX_RECOMMENDATIONS) return { valid: false, reason: 'too_many_recommendations' };

  const allow = new Set(allowedPlaceIds);
  const expected = expectedRecommendations ? new Map(expectedRecommendations.map((item) => [String(item.placeId), item])) : null;
  const seen = new Set();
  const seenRoles = new Set();
  for (const recommendation of raw.recommendations) {
    if (!recommendation || typeof recommendation.placeId !== 'string' || !allow.has(recommendation.placeId)) {
      return { valid: false, reason: 'place_not_allowlisted', rejectedPlaceId: recommendation?.placeId || null };
    }
    if (seen.has(recommendation.placeId)) return { valid: false, reason: 'duplicate_place' };
    seen.add(recommendation.placeId);
    if (!ROLES.has(recommendation.role)) return { valid: false, reason: 'unknown_role' };
    if (seenRoles.has(recommendation.role)) return { valid: false, reason: 'duplicate_role' };
    seenRoles.add(recommendation.role);
    if (!Array.isArray(recommendation.verifiedReasonCodes)
      || recommendation.verifiedReasonCodes.some((code) => !REASONS.has(code))) {
      return { valid: false, reason: 'unverified_reason' };
    }
    if (!TRADEOFFS.has(recommendation.tradeoffCode)) return { valid: false, reason: 'unknown_tradeoff' };
    if (expected) {
      const expectedItem = expected.get(recommendation.placeId);
      if (!expectedItem || expectedItem.role !== recommendation.role
        || expectedItem.tradeoffCode !== recommendation.tradeoffCode
        || JSON.stringify(expectedItem.verifiedReasonCodes) !== JSON.stringify(recommendation.verifiedReasonCodes)) {
        return { valid: false, reason: 'provider_changed_rule_batch', rejectedPlaceId: recommendation.placeId };
      }
    }
  }
  if (expected && (raw.recommendations.length !== expected.size
    || [...expected.keys()].some((id) => !seen.has(id)))) return { valid: false, reason: 'provider_changed_rule_batch' };
  if (raw.actions.some((action) => !action || !ACTIONS.has(action.type))) return { valid: false, reason: 'unknown_action' };
  if (!Number.isInteger(raw.remainingTurns) || raw.remainingTurns < 0) return { valid: false, reason: 'invalid_remaining_turns' };
  if (typeof raw.traceId !== 'string' || !raw.traceId) return { valid: false, reason: 'missing_trace' };
  return { valid: true, response: raw };
}

export function createTraceId(prefix = 'guide') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
