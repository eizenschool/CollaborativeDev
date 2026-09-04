// Deterministic, localized copy for the weather/route answers built from
// weather.ts and routeInfo.ts. Kept separate from guideCatalogueTemplates.ts,
// whose header explicitly scopes it to catalogue-boundary copy - this file
// is considerably larger (13 condition keys x 4 languages) and would bury it
// there. Same rule as every other fixed template in this module: en/zh-CN/
// ms/ta only, unknown tags fall back to en, because non-core languages are
// served by the model-phrasing path (renderProviderTextTurn) instead.
import type { GuideForecast, WeatherConditionKey } from "./weather.ts";
import type { GuideRouteEstimate } from "./routeInfo.ts";

const SUPPORTED = new Set(["en", "zh-CN", "ms", "ta"]);
function lang(language: string) { return SUPPORTED.has(language) ? language : "en"; }

const CONDITION_LABELS: Record<string, Record<WeatherConditionKey, string>> = {
  en: {
    clear: "clear", partly_cloudy: "partly cloudy", cloudy: "cloudy", fog: "foggy",
    drizzle: "light drizzle", rain: "rain", heavy_rain: "heavy rain", showers: "showers",
    violent_showers: "intense showers", thunderstorm: "thunderstorms",
    thunderstorm_hail: "severe thunderstorms with hail", freezing: "freezing rain", snow: "snow"
  },
  "zh-CN": {
    clear: "晴朗", partly_cloudy: "多云", cloudy: "阴天", fog: "有雾",
    drizzle: "小雨", rain: "有雨", heavy_rain: "大雨", showers: "阵雨",
    violent_showers: "强降雨", thunderstorm: "雷雨",
    thunderstorm_hail: "强雷雨伴冰雹", freezing: "冻雨", snow: "降雪"
  },
  ms: {
    clear: "cerah", partly_cloudy: "sedikit berawan", cloudy: "mendung", fog: "berkabus",
    drizzle: "hujan renyai", rain: "hujan", heavy_rain: "hujan lebat", showers: "hujan renjis",
    violent_showers: "hujan renjis lebat", thunderstorm: "ribut petir",
    thunderstorm_hail: "ribut petir teruk dengan hujan batu ais", freezing: "hujan beku", snow: "salji"
  },
  ta: {
    clear: "தெளிவான வானிலை", partly_cloudy: "ஓரளவு மேகமூட்டம்", cloudy: "மேகமூட்டம்", fog: "மூடுபனி",
    drizzle: "லேசான தூறல்", rain: "மழை", heavy_rain: "கனமழை", showers: "சாரல் மழை",
    violent_showers: "கடுமையான சாரல் மழை", thunderstorm: "இடி மின்னலுடன் மழை",
    thunderstorm_hail: "பனிக்கட்டியுடன் கடும் இடிமழை", freezing: "உறைபனி மழை", snow: "பனிப்பொழிவு"
  }
};

export function conditionLabel(language: string, key: WeatherConditionKey) {
  return CONDITION_LABELS[lang(language)][key];
}

function formatDate(language: string, date: string) {
  try {
    return new Intl.DateTimeFormat(lang(language), { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(`${date}T00:00:00+08:00`));
  } catch { return date; }
}

function round(value: number | null) {
  return value === null ? null : Math.round(value);
}

const DAY_TEMPLATE: Record<string, (parts: {
  date: string; condition: string; prob: number | null; tMax: number | null; tMin: number | null; apparent: number | null;
}) => string> = {
  en: ({ date, condition, prob, tMax, tMin, apparent }) => {
    const rain = prob === null ? "" : `, ${prob}% chance of rain`;
    const temps = tMax === null || tMin === null ? "" : `, ${tMax}°/${tMin}°`;
    const feels = apparent !== null && tMax !== null && Math.abs(apparent - tMax) >= 2 ? ` (feels like ${apparent}°)` : "";
    return `${date} — ${condition}${rain}${temps}${feels}`;
  },
  "zh-CN": ({ date, condition, prob, tMax, tMin, apparent }) => {
    const rain = prob === null ? "" : `，降雨概率 ${prob}%`;
    const temps = tMax === null || tMin === null ? "" : `，${tMax}°/${tMin}°`;
    const feels = apparent !== null && tMax !== null && Math.abs(apparent - tMax) >= 2 ? `（体感 ${apparent}°）` : "";
    return `${date}：${condition}${rain}${temps}${feels}`;
  },
  ms: ({ date, condition, prob, tMax, tMin, apparent }) => {
    const rain = prob === null ? "" : `, ${prob}% kemungkinan hujan`;
    const temps = tMax === null || tMin === null ? "" : `, ${tMax}°/${tMin}°`;
    const feels = apparent !== null && tMax !== null && Math.abs(apparent - tMax) >= 2 ? ` (terasa seperti ${apparent}°)` : "";
    return `${date} — ${condition}${rain}${temps}${feels}`;
  },
  ta: ({ date, condition, prob, tMax, tMin, apparent }) => {
    const rain = prob === null ? "" : `, மழை வாய்ப்பு ${prob}%`;
    const temps = tMax === null || tMin === null ? "" : `, ${tMax}°/${tMin}°`;
    const feels = apparent !== null && tMax !== null && Math.abs(apparent - tMax) >= 2 ? ` (${apparent}° போல் உணரப்படும்)` : "";
    return `${date} — ${condition}${rain}${temps}${feels}`;
  }
};

const WEATHER_INTRO: Record<string, (location: string) => string> = {
  en: (location) => `In ${location}: `,
  "zh-CN": (location) => `${location}的天气：`,
  ms: (location) => `Di ${location}: `,
  ta: (location) => `${location}இல்: `
};

const DATES_ASSUMED_NOTE: Record<string, string> = {
  en: " (no date given, so this covers today through the next couple of days — say a date if you meant something else)",
  "zh-CN": "（你没有指定日期，以下是今天到接下来几天的预报——如果想查别的日期请告诉我）",
  ms: " (tiada tarikh dinyatakan, jadi ini meliputi hari ini hingga beberapa hari akan datang — beritahu saya jika anda maksudkan tarikh lain)",
  ta: " (தேதி குறிப்பிடவில்லை, எனவே இது இன்று முதல் அடுத்த சில நாட்களை உள்ளடக்கியது — வேறு தேதி என்றால் சொல்லுங்கள்)"
};

const HORIZON_NOTE: Record<string, string> = {
  en: " I can only see about two weeks ahead — closer to the date I'll have the real forecast.",
  "zh-CN": "我最多只能查到大约两周内的天气——等日期近一点，我就能给你真实的预报。",
  ms: " Saya hanya boleh melihat kira-kira dua minggu ke hadapan — lebih hampir ke tarikh itu, saya akan ada ramalan sebenar.",
  ta: " எனக்கு சுமார் இரண்டு வாரங்கள் வரை மட்டுமே தெரியும் — தேதி நெருங்கும்போது உண்மையான முன்னறிவிப்பைத் தருவேன்."
};

const LOCATION_ASSUMED_NOTE: Record<string, (location: string) => string> = {
  en: (location) => ` You didn't say where, so this is for ${location} — name a specific place for something more precise.`,
  "zh-CN": (location) => `你没有指定地点，这是${location}的天气——想查更精确的地方可以直接告诉我。`,
  ms: (location) => ` Anda tidak menyatakan tempat, jadi ini untuk ${location} — namakan tempat tertentu untuk sesuatu yang lebih tepat.`,
  ta: (location) => ` நீங்கள் இடத்தைக் குறிப்பிடவில்லை, எனவே இது ${location}க்கானது — இன்னும் துல்லியமான தகவலுக்கு ஒரு குறிப்பிட்ட இடத்தைச் சொல்லுங்கள்.`
};

// Distinct from LOCATION_ASSUMED_NOTE: the traveller DID name a place, it
// just matched neither the catalogue nor the free city table - saying "I
// don't recognise X" is honest about what happened, instead of the generic
// "you didn't say where" implying they said nothing at all.
const LOCATION_UNRECOGNIZED_NOTE: Record<string, (unrecognized: string, fallback: string) => string> = {
  // Naming the catalogue here was misleading once towns resolve through
  // geocoding too: reaching this note means the name could not be placed
  // anywhere at all, which is a different thing from "not one of our venues".
  en: (unrecognized, fallback) => ` I couldn't find "${unrecognized}" on the map, so this is for ${fallback} instead — try the town it's in, or a bigger area name.`,
  "zh-CN": (unrecognized, fallback) => `我在地图上找不到「${unrecognized}」，先给你${fallback}的天气——可以换成它所在的城镇，或者更大范围的地名试试。`,
  ms: (unrecognized, fallback) => ` Saya tidak jumpa "${unrecognized}" di peta, jadi ini untuk ${fallback} — cuba nama bandar tempat ia berada, atau kawasan yang lebih besar.`,
  ta: (unrecognized, fallback) => ` வரைபடத்தில் "${unrecognized}" கிடைக்கவில்லை, எனவே இது ${fallback}க்கானது — அது அமைந்துள்ள நகரம் அல்லது பெரிய பகுதியின் பெயரை முயற்சிக்கவும்.`
};

export function weatherAnswerText(language: string, forecast: GuideForecast) {
  const key = lang(language);
  const intro = WEATHER_INTRO[key](forecast.locationName);
  const days = forecast.days.slice(0, 3).map((day) => DAY_TEMPLATE[key]({
    date: formatDate(key, day.date), condition: conditionLabel(key, day.conditionKey),
    prob: round(day.precipitationProbabilityMax), tMax: round(day.temperatureMaxC),
    tMin: round(day.temperatureMinC), apparent: round(day.apparentTemperatureMaxC)
  })).join(key === "zh-CN" ? "；" : "; ");
  const assumedNote = forecast.datesWereAssumed ? DATES_ASSUMED_NOTE[key] : "";
  const horizonNote = forecast.clampedToHorizon ? HORIZON_NOTE[key] : "";
  const locationNote = forecast.unrecognizedLocationName
    ? LOCATION_UNRECOGNIZED_NOTE[key](forecast.unrecognizedLocationName, forecast.locationName)
    : forecast.locationWasAssumed ? LOCATION_ASSUMED_NOTE[key](forecast.locationName) : "";
  return `${intro}${days}.${assumedNote}${horizonNote}${locationNote}`;
}

const MONSOON_STATES = new Set(["Kelantan", "Terengganu", "Pahang"]);
function isMonsoonMonth(month: number) { return month === 11 || month === 12 || month === 1 || month === 2; }

const HORIZON_TEXT: Record<string, (location: string, note: string, startDate: string) => string> = {
  en: (location, note, startDate) => `That's more than two weeks out, so there's no real forecast for ${location} yet.${note} Ask me again from ${startDate} and I'll check the actual forecast.`,
  "zh-CN": (location, note, startDate) => `这个日期超过两周了，${location}目前还没有真实预报。${note}到了 ${startDate} 之后再问我，我会查真实的预报。`,
  ms: (location, note, startDate) => `Itu lebih daripada dua minggu ke hadapan, jadi belum ada ramalan sebenar untuk ${location}.${note} Tanya saya lagi mulai ${startDate} dan saya akan semak ramalan sebenar.`,
  ta: (location, note, startDate) => `இது இரண்டு வாரங்களுக்கும் மேலாக இருப்பதால், ${location}க்கு இன்னும் உண்மையான முன்னறிவிப்பு இல்லை.${note} ${startDate} முதல் மீண்டும் கேளுங்கள், உண்மையான முன்னறிவிப்பைச் சரிபார்க்கிறேன்.`
};

const SEASONAL_NOTE: Record<string, (state: string) => string> = {
  en: (state) => ` For this time of year in ${state}, the north-east monsoon typically means more rain than usual.`,
  "zh-CN": (state) => `这个季节的${state}通常受东北季风影响，雨水会比平时多。`,
  ms: (state) => ` Pada waktu ini di ${state}, monsun timur laut biasanya membawa lebih banyak hujan berbanding biasa.`,
  ta: (state) => ` இந்த காலகட்டத்தில் ${state}-இல் வடகிழக்கு பருவமழை வழக்கத்தை விட அதிக மழையைத் தரும்.`
};

export function weatherHorizonText(language: string, locationName: string, state: string, startDate: string) {
  const key = lang(language);
  const month = Number(startDate.slice(5, 7));
  const note = MONSOON_STATES.has(state) && isMonsoonMonth(month) ? SEASONAL_NOTE[key](state) : "";
  return HORIZON_TEXT[key](locationName, note, startDate);
}

const SERVICE_DOWN_TEXT: Record<string, (location: string, note: string) => string> = {
  en: (location, note) => `The forecast service isn't answering for ${location} right now.${note} Try again in a few minutes and I'll get you the real numbers.`,
  "zh-CN": (location, note) => `${location}的天气服务暂时没有回应。${note}几分钟后再试一次，我会给你真实的数据。`,
  ms: (location, note) => `Perkhidmatan ramalan tidak menjawab untuk ${location} sekarang.${note} Cuba lagi dalam beberapa minit dan saya akan berikan angka sebenar.`,
  ta: (location, note) => `${location}க்கான வானிலை சேவை இப்போது பதிலளிக்கவில்லை.${note} சில நிமிடங்களில் மீண்டும் முயற்சிக்கவும், உண்மையான தகவலைத் தருகிறேன்.`
};

export function weatherServiceDownText(language: string, locationName: string, state: string, month: number) {
  const key = lang(language);
  const note = MONSOON_STATES.has(state) && isMonsoonMonth(month) ? SEASONAL_NOTE[key](state) : "";
  return SERVICE_DOWN_TEXT[key](locationName, note);
}

const WEATHER_LOCATION_CLARIFY: Record<string, string> = {
  en: "There are a few places by that name — which one? A town or city name works too.",
  "zh-CN": "有几个地方叫这个名字，你指的是哪一个？直接说城市或城镇名称也可以。",
  ms: "Ada beberapa tempat dengan nama itu — yang mana satu? Nama bandar pun boleh.",
  ta: "அந்தப் பெயரில் சில இடங்கள் உள்ளன — எது? நகரத்தின் பெயரைச் சொன்னாலும் போதும்."
};

export function weatherLocationClarifyText(language: string) {
  return WEATHER_LOCATION_CLARIFY[lang(language)];
}

const ROUTE_TEXT: Record<string, (destination: string, minutes: number, km: number, future: boolean) => string> = {
  en: (destination, minutes, km, future) => `${destination} is about ${minutes} minutes' drive away, roughly ${km} km, based on current traffic.${future ? " Since your trip date is later, treat this as a rough guide rather than a promise." : ""}`,
  "zh-CN": (destination, minutes, km, future) => `按目前路况，到${destination}大约需要 ${minutes} 分钟车程，约 ${km} 公里。${future ? "由于你的出行日期在后面，这个数字仅供参考。" : ""}`,
  ms: (destination, minutes, km, future) => `${destination} kira-kira ${minutes} minit perjalanan, lebih kurang ${km} km, berdasarkan trafik semasa.${future ? " Oleh kerana tarikh perjalanan anda kemudian, anggap ini sebagai panduan kasar sahaja." : ""}`,
  ta: (destination, minutes, km, future) => `தற்போதைய போக்குவரத்தின் அடிப்படையில், ${destination} சுமார் ${minutes} நிமிட பயணம், தோராயமாக ${km} கிமீ.${future ? " உங்கள் பயண தேதி பின்னர் இருப்பதால், இதை ஒரு தோராயமான வழிகாட்டியாக மட்டும் எடுத்துக்கொள்ளுங்கள்." : ""}`
};

const ROUTE_STRAIGHT_LINE_TEXT: Record<string, (destination: string, km: number, reasonNote: string) => string> = {
  en: (destination, km, reasonNote) => `${destination} is about ${km} km away in a straight line.${reasonNote}`,
  "zh-CN": (destination, km, reasonNote) => `${destination}的直线距离大约 ${km} 公里。${reasonNote}`,
  ms: (destination, km, reasonNote) => `${destination} kira-kira ${km} km jauhnya secara garis lurus.${reasonNote}`,
  ta: (destination, km, reasonNote) => `${destination} நேர்கோட்டில் சுமார் ${km} கிமீ தொலைவில் உள்ளது.${reasonNote}`
};

const ROUTE_REASON_NOTE: Record<string, Record<string, string>> = {
  en: {
    guide_budget_exhausted: " I've hit my daily limit for live drive times; they're back after midnight Malaysia time.",
    global_quota_exhausted: " I've hit my daily limit for live drive times; they're back after midnight Malaysia time.",
    no_route: " I couldn't find a drivable route between those two points — water or a border in the way, most likely.",
    routes_unconfigured: " Live drive times aren't available right now.",
    routes_failed: " Live drive times aren't available right now."
  },
  "zh-CN": {
    guide_budget_exhausted: "我今天的实时车程查询次数用完了，马来西亚时间午夜后恢复。",
    global_quota_exhausted: "我今天的实时车程查询次数用完了，马来西亚时间午夜后恢复。",
    no_route: "两地之间找不到可行驶的路线——很可能中间隔着水域或边境。",
    routes_unconfigured: "目前无法查询实时车程。",
    routes_failed: "目前无法查询实时车程。"
  },
  ms: {
    guide_budget_exhausted: " Saya telah mencapai had harian untuk masa pemanduan langsung; ia kembali selepas tengah malam waktu Malaysia.",
    global_quota_exhausted: " Saya telah mencapai had harian untuk masa pemanduan langsung; ia kembali selepas tengah malam waktu Malaysia.",
    no_route: " Saya tidak dapat mencari laluan yang boleh dipandu antara dua titik itu — mungkin ada air atau sempadan yang menghalang.",
    routes_unconfigured: " Masa pemanduan langsung tidak tersedia sekarang.",
    routes_failed: " Masa pemanduan langsung tidak tersedia sekarang."
  },
  ta: {
    guide_budget_exhausted: " நேரடி பயண நேர வரம்பை எட்டிவிட்டேன்; மலேசிய நேரப்படி நள்ளிரவுக்குப் பிறகு மீண்டும் கிடைக்கும்.",
    global_quota_exhausted: " நேரடி பயண நேர வரம்பை எட்டிவிட்டேன்; மலேசிய நேரப்படி நள்ளிரவுக்குப் பிறகு மீண்டும் கிடைக்கும்.",
    no_route: " அந்த இரு புள்ளிகளுக்கிடையே ஓட்டக்கூடிய பாதையைக் கண்டறிய முடியவில்லை — நீர்நிலை அல்லது எல்லை தடையாக இருக்கலாம்.",
    routes_unconfigured: " நேரடி பயண நேரங்கள் இப்போது கிடைக்கவில்லை.",
    routes_failed: " நேரடி பயண நேரங்கள் இப்போது கிடைக்கவில்லை."
  }
};

const ROUTE_NO_STRAIGHT_LINE: Record<string, string> = {
  en: "I can't pull live drive times until tomorrow, and I don't have precise coordinates for your starting point to estimate it myself. Tap 'Use my location' in the Travel Brief and I'll give you a rough distance right away.",
  "zh-CN": "我今天没办法查实时车程了，也没有你出发地的精确坐标来自己估算。点一下旅行概要里的「使用我的位置」，我马上给你一个大概距离。",
  ms: "Saya tidak dapat mendapatkan masa pemanduan langsung sehingga esok, dan saya tiada koordinat tepat untuk titik mula anda untuk menganggarkannya sendiri. Ketik 'Guna lokasi saya' dalam Ringkasan Perjalanan dan saya akan berikan anggaran jarak serta-merta.",
  ta: "நாளை வரை நேரடி பயண நேரங்களைப் பெற முடியாது, உங்கள் தொடக்க இடத்திற்கான துல்லியமான ஆயத்தொலைவுகளும் என்னிடம் இல்லை. பயணச் சுருக்கத்தில் 'எனது இருப்பிடத்தைப் பயன்படுத்து' என்பதைத் தட்டவும், உடனடியாக தோராயமான தூரத்தைத் தருகிறேன்."
};

export function routeAnswerText(language: string, estimate: GuideRouteEstimate) {
  const key = lang(language);
  if (estimate.kind === "google_routes" && estimate.durationSeconds !== null && estimate.distanceMeters !== null) {
    const minutes = Math.round(estimate.durationSeconds / 60);
    const km = Math.round(estimate.distanceMeters / 100) / 10;
    return ROUTE_TEXT[key](estimate.destinationName, minutes, km, false);
  }
  if (estimate.kind === "straight_line" && estimate.straightLineKm !== null) {
    const km = Math.round(estimate.straightLineKm * 10) / 10;
    const note = estimate.degradedReason ? ROUTE_REASON_NOTE[key][estimate.degradedReason] || "" : "";
    return ROUTE_STRAIGHT_LINE_TEXT[key](estimate.destinationName, km, note);
  }
  return ROUTE_NO_STRAIGHT_LINE[key];
}

const ROUTE_ORIGIN_CLARIFY: Record<string, string> = {
  en: "Where are you starting from? Tap 'Use my location' in the Travel Brief, or just tell me the town.",
  "zh-CN": "你会从哪里出发？可以点旅行概要里的「使用我的位置」，或者直接告诉我城市名称。",
  ms: "Dari mana anda bermula? Ketik 'Guna lokasi saya' dalam Ringkasan Perjalanan, atau beritahu saya nama bandar.",
  ta: "நீங்கள் எங்கிருந்து புறப்படுகிறீர்கள்? பயணச் சுருக்கத்தில் 'எனது இருப்பிடத்தைப் பயன்படுத்து' என்பதைத் தட்டவும் அல்லது நகரத்தின் பெயரைச் சொல்லுங்கள்."
};

export function routeOriginClarifyText(language: string) {
  return ROUTE_ORIGIN_CLARIFY[lang(language)];
}

// Every clarifying question names the form of answer it accepts. A traveller
// cannot otherwise tell that "which place?" takes a town name as happily as an
// attraction name - and being asked a second time for something they thought
// they had already given is the most frustrating way to find that out.
const ROUTE_DESTINATION_CLARIFY: Record<string, string> = {
  en: "Which place do you want the travel time to? A town or city works, so does a specific attraction.",
  "zh-CN": "你想查到哪个地点的车程？可以是城市或城镇，也可以是具体的景点。",
  ms: "Tempat mana yang anda mahu ketahui masa perjalanannya? Nama bandar atau tempat menarik yang khusus, kedua-duanya boleh.",
  ta: "எந்த இடத்திற்கான பயண நேரத்தை அறிய விரும்புகிறீர்கள்? ஒரு நகரம் அல்லது குறிப்பிட்ட சுற்றுலா இடம் — இரண்டுமே சரி."
};

export function routeDestinationClarifyText(language: string) {
  return ROUTE_DESTINATION_CLARIFY[lang(language)];
}

// Cities are valid destinations now, so "it isn't in the catalogue" became the
// wrong explanation for a name that resolved to nothing - it blames the
// catalogue for what is really "I could not place this name anywhere", and
// leaves the traveller with no idea what to try instead.
const ROUTE_DESTINATION_UNKNOWN: Record<string, (name: string) => string> = {
  en: (name) => `I couldn't place "${name}" on the map, so I can't work out the travel time to it. Try the town or city it sits in, or a well-known landmark nearby.`,
  "zh-CN": (name) => `我没能在地图上定位「${name}」，所以算不出车程。可以试试它所在的城市或城镇，或者附近比较知名的地标。`,
  ms: (name) => `Saya tidak dapat mencari "${name}" di peta, jadi saya tidak dapat mengira masa perjalanan ke sana. Cuba nama bandar tempat ia berada, atau mercu tanda terkenal berdekatan.`,
  ta: (name) => `"${name}" என்பதை வரைபடத்தில் கண்டறிய முடியவில்லை, எனவே பயண நேரத்தைக் கணக்கிட முடியவில்லை. அது அமைந்துள்ள நகரத்தை அல்லது அருகிலுள்ள பிரபலமான அடையாள இடத்தை முயற்சிக்கவும்.`
};

export function routeDestinationUnknownText(language: string, name: string) {
  return ROUTE_DESTINATION_UNKNOWN[lang(language)](name);
}
