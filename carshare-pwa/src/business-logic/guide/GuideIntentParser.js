// ===== BUSINESS LOGIC LAYER (Tumpang Guide intent parser) =====
import { CATEGORY } from '../discovery/constants.js';
import { GUIDE_LIMITS, GUIDE_ORIGIN } from './constants.js';
import { detectGuideLanguage, normalizeGuideLanguage } from './GuideLanguage.js';

const CATEGORY_WORDS = Object.freeze({
  [CATEGORY.CULINARY]: ['food', 'eat', 'restaurant', 'cafe', 'culinary', 'makanan', 'makan', '美食', '吃', '餐厅', 'உணவு', 'சாப்பாடு'],
  [CATEGORY.HERITAGE]: ['heritage', 'history', 'culture', 'museum', 'warisan', 'sejarah', '文化', '历史', '博物馆', 'பாரம்பரியம்', 'வரலாறு'],
  [CATEGORY.NATURE]: ['nature', 'outdoor', 'park', 'hike', 'beach', 'alam', 'taman', '自然', '户外', '公园', 'இயற்கை', 'பூங்கா'],
  [CATEGORY.EVENT]: ['event', 'festival', 'concert', 'acara', 'festival', '活动', '节庆', 'நிகழ்வு', 'விழா']
});

const ORIGIN_PATTERNS = [
  /(?:from|starting (?:at|from)|leave from)\s+([\p{L}\d .'-]{2,50})/iu,
  /(?:从|由)\s*([\p{L}\d .'-]{2,30})(?:出发|開始|开始)/u,
  /(?:dari|bertolak dari)\s+([\p{L}\d .'-]{2,50})/iu,
  /(?:இருந்து|தொடக்கம்)\s*([\p{L}\d .'-]{2,40})/u,
  /([\p{L}\d .'-]{2,40})\s*(?:இருந்து|தொடங்கி)/u
];

const PARTY_PATTERNS = [
  /\b(?:for|party of)\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:people|persons|travellers|pax|orang)\b/i,
  /(\d{1,2})\s*(?:人|位)/u,
  /(\d{1,2})\s*(?:பேர்|நபர்)/u
];

const WORD_PARTY_PATTERN = /\b(one|two|three|four|five|six|seven|eight|nine|ten|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh)\s+(?:people|persons|travellers|pax|orang)\b/i;
const WORD_PARTY_SIZE = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, sembilan: 9, sepuluh: 10
});

const GROUP_PHRASES = Object.freeze([
  [/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+of\s+us\b/i, WORD_PARTY_SIZE],
  [/\bwe(?:'re| are)\s+(\d{1,2})\b/i, null],
  [/我们(?:有|是)?\s*(\d{1,2})\s*(?:个人|人|位)/u, null],
  [/\b(?:kami|kita)\s+(\d{1,2})\s+orang\b/i, null]
]);

function parseGroupPhrase(text) {
  for (const [pattern, wordSizes] of GROUP_PHRASES) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const parsed = wordSizes ? wordSizes[String(match[1]).toLocaleLowerCase()] : Number(match[1]);
    if (Number.isFinite(parsed)) return Math.min(20, Math.max(1, parsed));
  }
  return null;
}

function localIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return localIso(date);
}

export function dateRangeDays(startDate, endDate = startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) return [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const days = [];
  for (let cursor = start; cursor <= end && days.length < GUIDE_LIMITS.MAX_DATE_RANGE_DAYS; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    days.push(localIso(cursor));
  }
  return days;
}

export function normalizePlanState(value = {}) {
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(value.startDate || '') ? value.startDate : null;
  const requestedEnd = /^\d{4}-\d{2}-\d{2}$/.test(value.endDate || '') ? value.endDate : startDate;
  const range = startDate ? dateRangeDays(startDate, requestedEnd) : [];
  const partySize = Number(value.partySize);
  const preferredCategories = [...new Set((value.preferredCategories || []).filter((item) => Object.values(CATEGORY).includes(item)))];
  return {
    origin: value.origin?.label ? {
      label: String(value.origin.label).slice(0, 80),
      lat: Number.isFinite(value.origin.lat) ? value.origin.lat : undefined,
      lng: Number.isFinite(value.origin.lng) ? value.origin.lng : undefined
    } : null,
    partySize: Number.isInteger(partySize) && partySize >= 1 && partySize <= 20 ? partySize : null,
    startDate,
    endDate: range.at(-1) || startDate,
    preferredCategories,
    budget: ['free', 'low', 'medium', 'premium'].includes(value.budget) ? value.budget : null,
    indoorPreference: ['indoor', 'outdoor', 'either'].includes(value.indoorPreference) ? value.indoorPreference : 'either',
    accessibilityRequired: Boolean(value.accessibilityRequired),
    children: Boolean(value.children),
    tripHistoryConsent: Boolean(value.tripHistoryConsent),
    language: normalizeGuideLanguage(value.language),
    recommendationMode: ['default', 'different', 'quieter'].includes(value.recommendationMode)
      ? value.recommendationMode : 'default'
  };
}

function parseDate(text, today) {
  const explicit = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];
  if (/\b(?:tomorrow|esok)\b|明天|நாளை/i.test(text)) return addDays(today, 1);
  if (/\b(?:today|hari ini)\b|今天|இன்று/i.test(text)) return today;
  if (/\b(?:weekend|hujung minggu)\b|周末|週末|வார இறுதி/i.test(text)) {
    const [y, m, d] = today.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const delta = (6 - base.getDay() + 7) % 7 || 7;
    return addDays(today, delta);
  }
  return null;
}

function parseRangeEnd(text, startDate) {
  const range = text.match(/(?:to|until|through|hingga|到|至)\s*(20\d{2}-\d{2}-\d{2})/iu);
  if (range) return range[1];
  const days = text.match(/\b([2-7])\s*(?:days|hari)\b|([2-7])\s*天|([2-7])\s*நாட்கள்/iu);
  const count = Number(days?.[1] || days?.[2] || days?.[3]);
  return count && startDate ? addDays(startDate, count - 1) : startDate;
}

export function mergeGuideIntent(planState, text, { today = localIso(new Date()), manualLanguage = null } = {}) {
  const value = String(text || '').trim().slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS);
  const next = normalizePlanState({
    ...planState,
    language: manualLanguage ? normalizeGuideLanguage(manualLanguage) : detectGuideLanguage(value, planState?.language)
  });
  const baseToday = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : localIso(new Date());

  const parsedDate = parseDate(value, baseToday);
  if (parsedDate) {
    next.startDate = parsedDate;
    next.endDate = parseRangeEnd(value, parsedDate);
  }

  const wordParty = value.match(WORD_PARTY_PATTERN);
  if (wordParty) next.partySize = WORD_PARTY_SIZE[wordParty[1].toLocaleLowerCase()];
  const groupPhrase = parseGroupPhrase(value);
  if (groupPhrase) next.partySize = groupPhrase;
  for (const pattern of PARTY_PATTERNS) {
    const match = value.match(pattern);
    if (match) { next.partySize = Math.min(20, Math.max(1, Number(match[1]))); break; }
  }

  for (const pattern of ORIGIN_PATTERNS) {
    const match = value.match(pattern);
    if (match) { next.origin = { label: match[1].trim().replace(/[,.!?]+$/, '') }; break; }
  }
  if (/\b(?:kuala lumpur|kl)\b/i.test(value) || /吉隆坡/u.test(value)) next.origin = { ...GUIDE_ORIGIN };

  const requested = new Set(next.preferredCategories);
  for (const [category, words] of Object.entries(CATEGORY_WORDS)) {
    if (words.some((word) => value.toLocaleLowerCase().includes(word.toLocaleLowerCase()))) requested.add(category);
  }
  next.preferredCategories = [...requested];

  if (/\b(?:wheelchair|accessible|mobility)\b|无障碍|無障礙|சக்கர நாற்காலி/iu.test(value)) next.accessibilityRequired = true;
  if (/\b(?:children|kids|family)\b|亲子|孩子|குழந்தை/iu.test(value)) next.children = true;
  if (/\b(?:indoor|indoors|dalam bangunan)\b|室内|室內|உட்புற/iu.test(value)) next.indoorPreference = 'indoor';
  if (/\b(?:outdoor|outdoors|luar)\b|户外|戶外|வெளிப்புற/iu.test(value)) next.indoorPreference = 'outdoor';
  if (/\b(?:free|no cost|percuma)\b|免费|免費|இலவச/iu.test(value)) next.budget = 'free';
  else if (/\b(?:cheap|budget|murah)\b|便宜|预算|பட்ஜெட்/iu.test(value)) next.budget = 'low';

  if (/\b(?:different|other|another|new places|elsewhere|change places|change the places)\b|其他|別的|不同|换个|换一个|換個|換一個|lain|berbeza|வேறு/iu.test(value)) {
    next.recommendationMode = 'different';
  } else if (/\b(?:quieter|quiet|less busy|calmer)\b|安静|安靜|清静|tenang|அமைதியான/iu.test(value)) {
    next.recommendationMode = 'quieter';
  } else if (value) {
    next.recommendationMode = 'default';
  }

  return normalizePlanState(next);
}

export function mostImportantMissingField(planState) {
  const plan = normalizePlanState(planState);
  if (!plan.startDate) return 'date';
  if (!plan.origin) return 'origin';
  if (!plan.partySize) return 'party';
  if (!plan.preferredCategories.length) return 'preference';
  return null;
}

export function sanitizedPlanSummary(planState) {
  const plan = normalizePlanState(planState);
  return {
    ...plan,
    origin: plan.origin ? { label: plan.origin.label } : null
  };
}
