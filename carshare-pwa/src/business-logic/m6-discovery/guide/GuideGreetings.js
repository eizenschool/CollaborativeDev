// ===== BUSINESS LOGIC LAYER (Tumpang Guide greetings) =====
// A different opening line each time the chat is freshly opened, the way
// Claude's own web app varies its welcome - purely a client-side pick, no
// backend/AI call and no effect on routing or the Travel Brief.
import { normalizeGuideLanguage } from './GuideLanguage.js';

const GREETING_ROTATION_KEY = 'letstumpang_m6_guide_greeting_index_v1';

const GREETINGS = Object.freeze({
  en: [
    "Tell me the kind of day you want, and I'll only suggest places already in Let's Tumpang.",
    "Hey there! Where's your head at today - food, nature, heritage, or something else?",
    "Ready when you are. Describe your day and I'll pull from our verified catalogue.",
    "Let's find your next good outing. What sounds good right now?",
    "Back again? Tell me what you're in the mood for and I'll take it from there."
  ],
  'zh-CN': [
    '告诉我你想要怎样的一天，我只会推荐 Let\'s Tumpang 资料库里已有的地点。',
    '嗨！今天想去哪种地方——美食、大自然、文化遗产，还是别的？',
    '我准备好了，说说你的计划，我会从已验证的目录里找选项。',
    '一起找找下次的好去处吧，你现在想要什么感觉？',
    '又见面啦，告诉我你的心情，我来接手。'
  ],
  ms: [
    'Beritahu saya hari yang anda inginkan. Saya hanya mencadangkan tempat yang sudah ada dalam pangkalan data Let\'s Tumpang.',
    'Hai! Apa yang anda fikirkan hari ini - makanan, alam semula jadi, warisan, atau lain-lain?',
    'Saya sedia bila-bila masa. Terangkan hari anda dan saya akan cari daripada katalog yang disahkan.',
    'Jom cari destinasi seterusnya. Apa yang menarik minat anda sekarang?',
    'Kembali lagi? Beritahu saya apa yang anda mahu dan saya akan uruskan.'
  ],
  ta: [
    'நீங்கள் விரும்பும் நாளைப் பற்றி சொல்லுங்கள். Let\'s Tumpang தரவுத்தளத்தில் உள்ள இடங்களை மட்டுமே பரிந்துரைப்பேன்.',
    'வணக்கம்! இன்று என்ன மனநிலையில் இருக்கிறீர்கள் - உணவு, இயற்கை, பாரம்பரியம், அல்லது வேறு ஏதாவது?',
    'நான் தயார். உங்கள் நாளை விளக்குங்கள், சரிபார்க்கப்பட்ட பட்டியலிலிருந்து தேடுகிறேன்.',
    'உங்கள் அடுத்த சிறந்த வெளியீட்டைத் தேடுவோம். இப்போது என்ன பிடிக்கும்?',
    'மீண்டும் வந்தீர்களா? உங்கள் மனநிலையைச் சொல்லுங்கள், நான் தொடர்கிறேன்.'
  ]
});

/**
 * Rotates to the next greeting for a freshly created welcome message. Returns
 * both the text and the index it landed on - the index must be kept on the
 * response so a later UI-language switch can re-translate the *same* slot
 * (via greetingAt) instead of silently re-rolling into a different greeting.
 */
export function pickGuideGreeting(language) {
  const normalized = normalizeGuideLanguage(language);
  const list = GREETINGS[normalized] || GREETINGS.en;
  let index = 0;
  try {
    const stored = JSON.parse(localStorage.getItem(GREETING_ROTATION_KEY) || '{}');
    const last = Number(stored?.[normalized]);
    // Rotate forward rather than pick randomly so the same greeting never
    // repeats twice in a row, while still varying across visits.
    index = Number.isFinite(last) ? (last + 1) % list.length : 0;
    localStorage.setItem(GREETING_ROTATION_KEY, JSON.stringify({ ...stored, [normalized]: index }));
  } catch { /* Falls back to the first greeting when storage is unavailable. */ }
  return { text: list[index] || list[0], index };
}

/** Pure lookup, no rotation - used to re-localize an existing welcome message. */
export function greetingAt(language, index) {
  const normalized = normalizeGuideLanguage(language);
  const list = GREETINGS[normalized] || GREETINGS.en;
  const safeIndex = Number.isInteger(index) && index >= 0 ? index % list.length : 0;
  return list[safeIndex] || list[0];
}
