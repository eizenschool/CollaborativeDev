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
  /\b(?:call\s+999|medical emergency|immediate danger|being attacked|car (?:crash|accident)|someone (?:is )?(?:unconscious|bleeding|dying)|need (?:the )?(?:police|ambulance) now)\b/i,
  /拨打\s*999|立即危险|有人(?:昏迷|流血|快死)|正在被攻击|严重车祸/u,
  /\b(?:hubungi\s*999|bahaya segera|sedang diserang|kemalangan serius)\b/i,
  /999\s*ஐ?\s*அழை|உடனடி ஆபத்து|தாக்கப்படுகிறேன்/u
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

export function shouldUseLocalGuideRules({ online = true, fixtureMode = false, qaMode = false, forceFallback = '' } = {}) {
  return Boolean(fixtureMode || !online || (qaMode && forceFallback === 'offline'));
}

export function safeRecentMessages(messages = []) {
  return messages
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .slice(-GUIDE_LIMITS.CONTEXT_TURNS * 2)
    .map((message) => ({ role: message.role, text: String(message.text || '').slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS) }));
}

export function guideResponseContextText(response = {}) {
  if (response?.placeInfo) {
    const info = response.placeInfo;
    const highlights = Array.isArray(info.highlights) ? info.highlights.filter(Boolean).join('; ') : '';
    const practical = Array.isArray(info.practicalNotes) ? info.practicalNotes.filter(Boolean).join('; ') : '';
    return [
      `Previous public venue facts for ${info.officialName || info.place?.name || 'the selected place'}.`,
      highlights ? `Already covered activities: ${highlights}` : '',
      practical ? `Already covered practical information: ${practical}` : ''
    ].filter(Boolean).join(' ').slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS);
  }
  return String(response?.localizedMessage || response?.assistantMessage || '')
    .slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS);
}

export function validateGuideResponse(raw, allowedPlaceIds = [], { expectedRecommendations = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, reason: 'invalid_json_shape' };
  if (!MODES.has(raw.mode)) return { valid: false, reason: 'unknown_mode' };
  if (!GUIDE_LANGUAGES.includes(raw.language) && !/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(raw.language || ''))) return { valid: false, reason: 'unknown_language' };
  if (typeof raw.assistantMessage !== 'string' || !raw.assistantMessage.trim()) return { valid: false, reason: 'missing_message' };
  if (!Array.isArray(raw.quickReplies) || !Array.isArray(raw.recommendations) || !Array.isArray(raw.actions)) {
    return { valid: false, reason: 'invalid_collections' };
  }
  if (raw.mode === GUIDE_MODE.SMALL_TALK && (raw.recommendations.length || raw.actions.length)) {
    return { valid: false, reason: 'small_talk_has_actions' };
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
  const mutatingActions = new Set([
    GUIDE_ACTION.RECORD_INTEREST, GUIDE_ACTION.REGISTER_RIDE_ALERT,
    GUIDE_ACTION.SAVE_PREFERENCES, GUIDE_ACTION.REQUEST_CATALOGUE
  ]);
  for (const action of raw.actions) {
    if (!action || !ACTIONS.has(action.type)) return { valid: false, reason: 'unknown_action' };
    if (action.placeId && !allow.has(action.placeId)) {
      return { valid: false, reason: 'action_place_not_allowlisted', rejectedPlaceId: action.placeId };
    }
    if (mutatingActions.has(action.type) && action.requiresConfirmation !== true) {
      return { valid: false, reason: 'action_confirmation_required' };
    }
  }
  if (!Number.isInteger(raw.remainingTurns) || raw.remainingTurns < 0) return { valid: false, reason: 'invalid_remaining_turns' };
  if (typeof raw.traceId !== 'string' || !raw.traceId) return { valid: false, reason: 'missing_trace' };
  return { valid: true, response: raw };
}

export function createTraceId(prefix = 'guide') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
