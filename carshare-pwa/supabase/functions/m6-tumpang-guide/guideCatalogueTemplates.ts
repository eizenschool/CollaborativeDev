// Fixed, non-AI response templates for catalogue-boundary answers
// (get_place_information/catalogue_missing). These are rendered only after
// the owning provider has already chosen its tool and, for place_info,
// after the server has validated the requested name against the catalogue
// (index.ts) - never as a routing decision themselves. Kept separate from
// the (removed) deterministic routing module so it's obvious this file has
// no say in which tool or mode a turn resolves to.

const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN", "ms", "ta"]);

export function namedPlaceResponseLanguage(message: string, preferred: unknown) {
  const text = String(message || "");
  if (/[஀-௿]/u.test(text)) return "ta";
  if (/[㐀-鿿]/u.test(text)) return "zh-CN";
  if (/\b(?:saya|kami|nak|mahu|pergi|tempat|makanan|warisan|cuaca|tolong|apa|yang|boleh|dibuat|cadang(?:kan)?|cadangkan|makan|alam|hari|anda|awak|suka|dekat|jauh|senyap|lain|ceritakan|maklumat|waktu operasi|harga tiket)\b/iu.test(text)) return "ms";
  if (/[A-Za-z]/u.test(text)) return "en";
  const fallback = String(preferred || "en");
  return SUPPORTED_LANGUAGES.has(fallback) ? fallback : "en";
}

export function catalogueMissingMessage(language: string) {
  if (language === "zh-CN") return "Tumpang Guide 只能介绍 Let's Tumpang 资料库已收录的地点。这个地点目前不在目录中。";
  if (language === "ms") return "Tumpang Guide hanya boleh menerangkan tempat yang sudah disenaraikan dalam katalog Let's Tumpang. Tempat ini belum ada dalam katalog.";
  if (language === "ta") return "Let's Tumpang பட்டியலில் ஏற்கனவே உள்ள இடங்களை மட்டுமே Tumpang Guide விளக்க முடியும். இந்த இடம் தற்போது பட்டியலில் இல்லை.";
  return "Tumpang Guide can only provide place information for destinations already listed in the Let's Tumpang catalogue. This place is not currently in the catalogue.";
}

export function cataloguePlaceMessage(language: string, name: string) {
  if (language === "zh-CN") return `我来介绍 ${name} 的最新地点资料。`;
  if (language === "ms") return `Berikut ialah maklumat tempat terkini tentang ${name}.`;
  if (language === "ta") return `${name} பற்றிய சமீபத்திய இடத் தகவல்கள் இங்கே உள்ளன.`;
  return `Here is the latest place information about ${name}.`;
}

export function selfContradictedInfoBrushOff(language: string) {
  // Used when the model's own drafted assistantMessage already admitted it
  // couldn't check real-time conditions (weather/transport) but still
  // attached a recommendation batch (see policy.ts's
  // detectSelfContradictedInfoRecommendation). The cards get stripped
  // server-side; this replaces the now-orphaned "I can't check that, but
  // here are some places..." text itself with a light, self-aware line so
  // the reply reads as an intentional brush-off, not a broken half-answer.
  if (language === "zh-CN") return "哈，我还没有水晶球，查不到即时天气或路况这类信息，你可以用天气 App 看一下～有想去哪里晃晃的话，随时再问我！";
  if (language === "ms") return "Hehe, saya belum ada bola kristal untuk semak cuaca atau keadaan jalan secara langsung - cuba app cuaca anda! Bila dah bersedia nak pergi mana-mana, tanya saya lagi.";
  if (language === "ta") return "ஹஹா, நேரடி வானிலை அல்லது போக்குவரத்தைச் சரிபார்க்க எனக்கு இன்னும் படிக மாற்பொருள் இல்லை - உங்கள் வானிலை ஆப்பைப் பாருங்கள்! எங்கு செல்ல வேண்டும் என நினைத்தால் மீண்டும் கேளுங்கள்.";
  return "Ha, I don't have a weather crystal ball just yet - I can't check live weather or traffic conditions, so a quick look at your weather app will serve you better there. Whenever you're ready to figure out where to go, just ask!";
}

export function ambiguousCatalogueMessage(language: string) {
  if (language === "zh-CN") return "我找到多个相近的已收录地点。你指的是哪一个？";
  if (language === "ms") return "Saya menemui beberapa tempat dalam katalog yang serupa. Yang manakah anda maksudkan?";
  if (language === "ta") return "பட்டியலில் ஒரே போன்ற பல இடங்கள் உள்ளன. நீங்கள் எதைக் குறிப்பிடுகிறீர்கள்?";
  return "I found several similar catalogue places. Which one did you mean?";
}
