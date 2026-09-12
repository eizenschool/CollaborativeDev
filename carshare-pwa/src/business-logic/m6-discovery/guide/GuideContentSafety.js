// ===== BUSINESS LOGIC LAYER (Guide content safety) =====
// This module is deliberately dependency-free so the browser and the Guide
// Edge Function can apply the same policy before any provider or persistence
// work. It returns policy metadata only; matched words are never returned or
// logged.

export const GUIDE_CONTENT_SAFETY_POLICY_VERSION = 'm6-content-safety-v1';

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/gu;
const REPEATED_PUNCTUATION = /([!?.,])\1{2,}/gu;
const OBFUSCATION_MAP = Object.freeze({
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '@': 'a'
});

function normalizeForPolicy(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(REPEATED_PUNCTUATION, '$1')
    .replace(/[013457$@]/gu, (character) => OBFUSCATION_MAP[character] || character)
    .replace(/\s+/gu, ' ')
    .trim();
}

function languageHints(value) {
  const text = String(value || '');
  const hints = [];
  if (/[\u3400-\u9FFF]/u.test(text)) hints.push('zh-CN');
  if (/[\u0B80-\u0BFF]/u.test(text)) hints.push('ta');
  if (/\b(?:saya|aku|nak|mahu|makan|tempat|pergi|tolong|kau|awak|kamu|bodoh|bangang)\b/iu.test(text)) hints.push('ms');
  if (/[a-z]/iu.test(text)) hints.push('en');
  return [...new Set(hints)];
}

// The entries are policy data, rather than checks spread through the UI and
// request handler. Patterns are intentionally high precision: a generic
// swear word may be masked, while a targeted insult, hate statement or threat
// is blocked. Common food/place words are excluded from the lexicon.
const POLICY_RULES = Object.freeze([
  { id: 'en-casual', category: 'casual_profanity', patterns: [
    /\bf[\s._-]*u[\s._-]*c[\s._-]*k+\b/iu,
    /\bs[\s._-]*h[\s._-]*i[\s._-]*t+\b/iu,
    /\bd[\s._-]*a[\s._-]*m[\s._-]*n\b/iu, /\bhell\b/iu
  ] },
  { id: 'zh-casual', category: 'casual_profanity', patterns: [
    /(?:他妈的|妈的|我操)/u
  ] },
  { id: 'ms-casual', category: 'casual_profanity', patterns: [
    /\b(?:pukimak|puki mak|lancau|cibai|celaka)\b/iu
  ] },
  { id: 'ta-casual', category: 'casual_profanity', patterns: [
    /(?:தேவடியா|போடா|சீடா)/u
  ] },
  { id: 'en-targeted', category: 'targeted_abuse', patterns: [
    /\b(?:you(?:'re| are)?|u r|ur)\s+(?:an?\s+)?(?:idiot|stupid|dumb|moron|asshole|bastard)\b/iu,
    /^\s*(?:idiot|stupid|dumb|moron|asshole|bastard)\s*[.!?]*\s*$/iu
  ] },
  { id: 'zh-targeted', category: 'targeted_abuse', patterns: [
    /(?:你|妳)(?:很|真|就是|这个|這個|是个|是個|真是)?(?:蠢|笨蛋|白痴|傻逼|傻B|废物)/u,
    /^\s*(?:蠢货|笨蛋|白痴|傻逼|废物)\s*[。！？.!?]*\s*$/u
  ] },
  { id: 'ms-targeted', category: 'targeted_abuse', patterns: [
    /\b(?:kau|awak|kamu|anda)\s+(?:memang\s+)?(?:bodoh|bangang|bengap|sial|celaka)\b/iu,
    /^\s*(?:bodoh|bangang|bengap|sial|celaka)\s*[.!?]*\s*$/iu
  ] },
  { id: 'ta-targeted', category: 'targeted_abuse', patterns: [
    /(?:நீ|உன்)(?: மிகவும்| ரொம்ப)?\s*(?:முட்டாள்|மடையன்|நாயே|பைத்தியம்)/u,
    /^\s*(?:முட்டாள்|மடையன்|நாயே)\s*[.!?]*\s*$/u
  ] },
  { id: 'en-threat', category: 'threat', patterns: [
    /\b(?:i(?:'ll| will)|i am going to|i'm going to)\s+(?:kill|hurt|beat|shoot)\s+(?:you|him|her|them)\b/iu,
    /\b(?:kill|hurt|beat|shoot)\s+(?:you|him|her|them)\b/iu,
    /\b(?:go|drop)\s+dead\b/iu
  ] },
  { id: 'zh-threat', category: 'threat', patterns: [
    /(?:杀了你|弄死你|打死你|我要杀|去死吧)/u
  ] },
  { id: 'ms-threat', category: 'threat', patterns: [
    /\b(?:aku|saya)\s+(?:akan\s+)?(?:bunuh|cederakan|pukul)\s+(?:kau|awak|kamu|anda)\b/iu,
    /\b(?:bunuh|cederakan|pukul)\s+(?:kau|awak|kamu|anda)\b/iu
  ] },
  { id: 'ta-threat', category: 'threat', patterns: [
    /(?:உன்னை கொன்றுவிடுவேன்|உன்னை அடிப்பேன்|செத்துப்போ)/u
  ] },
  { id: 'en-hate', category: 'hate', patterns: [
    /\b(?:i hate|all|every)\s+(?:muslims?|christians?|hindus?|jews?|malays?|chinese|indians?|immigrants?|foreigners?|women|men|disabled people|lgbtq?)\s+(?:should|must|need to|are)\s+(?:die|be killed|get out|disgusting)\b/iu
  ] },
  { id: 'zh-hate', category: 'hate', patterns: [
    /(?:穆斯林|基督徒|印度教徒|犹太人|马来人|华人|印度人|外国人|女人|男人|残障人士|同性恋者)(?:都|全都)?(?:该死|应该去死|滚出去|很恶心)/u
  ] },
  { id: 'ms-hate', category: 'hate', patterns: [
    /\b(?:muslim|kristian|hindu|yahudi|melayu|cina|india|pendatang|orang asing|wanita|lelaki|orang kurang upaya)\s+(?:patut|mesti)\s+(?:mati|dihalau)\b/iu
  ] },
  { id: 'ta-hate', category: 'hate', patterns: [
    /(?:முஸ்லிம்கள்|கிறிஸ்தவர்கள்|இந்துக்கள்|யூதர்கள்|மலாய்க்காரர்கள்|சீனர்கள்|இந்தியர்கள்|வெளிநாட்டவர்கள்|பெண்கள்|ஆண்கள்)(?: அனைவரும்)?\s*(?:சாகவேண்டும்|வெளியேற வேண்டும்|அருவருப்பானவர்கள்)/u
  ] }
]);

// These phrases represent a person asking for urgent help, rather than
// threatening somebody. They are checked before abuse rules so a distressed
// traveller is not blocked merely because their wording is impolite.
const EMERGENCY_PATTERNS = Object.freeze([
  /\b(?:call|dial)\s*999\b/iu,
  /\b(?:need|send)\s+(?:the\s+)?(?:police|ambulance)\s+now\b/iu,
  /\b(?:being attacked|someone is attacking me|someone is unconscious|someone is bleeding|cannot breathe|chest pain|serious car crash|medical emergency|immediate danger|i(?:'m| am|m)\s+in\s+(?:immediate\s+)?danger)\b/iu,
  /(?:拨打|打)\s*999|立即危险|我(?:现在|正)?在危险中|我有危险|有人(?:昏迷|流血)|正在被攻击|严重车祸|无法呼吸|胸痛/u,
  /\b(?:hubungi|panggil)\s*999\b|\b(?:bahaya segera|sedang diserang|kemalangan serius|sukar bernafas|sakit dada|(?:saya|aku)\s+dalam\s+bahaya)\b/iu,
  /999\s*(?:அழை|அழைக்கவும்)|உடனடி ஆபத்து|நான்\s+ஆபத்தில்|தாக்கப்படுகிறேன்|மூச்சு விட முடியவில்லை|நெஞ்சு வலி/u
]);

function findMatches(text) {
  const matches = [];
  for (const rule of POLICY_RULES) {
    for (const pattern of rule.patterns) {
      const repeated = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match;
      while ((match = repeated.exec(text))) {
        matches.push({ rule, index: match.index ?? 0, length: match[0].length });
        if (!match[0]) repeated.lastIndex += 1;
      }
    }
  }
  return matches;
}

function maskMatches(text, matches) {
  const ranges = matches
    .filter((match) => match.rule.category === 'casual_profanity')
    .map((match) => [match.index, match.index + match.length])
    .sort((left, right) => left[0] - right[0]);
  if (!ranges.length) return text;
  let output = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    output += text.slice(cursor, start);
    output += '*'.repeat(Math.max(3, end - start));
    cursor = end;
  }
  return `${output}${text.slice(cursor)}`.replace(/\s{2,}/gu, ' ').trim();
}

function hasEmergencyRequest(text) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyGuideContent(value) {
  const normalized = normalizeForPolicy(value);
  const hints = languageHints(normalized);
  if (!normalized) {
    return { decision: 'allow', category: 'none', sanitizedText: '', languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION };
  }

  const matches = findMatches(normalized);
  const categories = new Set(matches.map((match) => match.rule.category));
  const hasThreat = categories.has('threat') || categories.has('hate');
  if (hasEmergencyRequest(normalized) && !hasThreat) {
    return {
      decision: 'emergency', category: 'emergency_help', sanitizedText: maskMatches(normalized, matches),
      languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION
    };
  }
  if (hasThreat) {
    return { decision: 'block', category: categories.has('hate') ? 'hate' : 'threat', sanitizedText: '', languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION };
  }
  if (categories.has('targeted_abuse')) {
    return { decision: 'block', category: 'targeted_abuse', sanitizedText: '', languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION };
  }
  if (categories.has('casual_profanity')) {
    return { decision: 'mask', category: 'casual_profanity', sanitizedText: maskMatches(normalized, matches), languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION };
  }
  return { decision: 'allow', category: 'none', sanitizedText: normalized, languageHints: hints, policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION };
}

export const guideContentSafetyInternals = Object.freeze({ normalizeForPolicy, languageHints, maskMatches });
