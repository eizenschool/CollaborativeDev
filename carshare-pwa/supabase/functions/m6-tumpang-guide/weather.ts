// Deterministic weather for the Guide's get_weather_forecast tool. Keyless
// Open-Meteo, same host/timezone as retrieval.ts's existing weather-gate
// call, but not lossy: this keeps per-day rain probability and temperature
// instead of collapsing everything into two booleans, because "will it
// rain this weekend" needs an actual number, not a severity flag.

type Row = Record<string, unknown>;

export type WeatherConditionKey =
  | "clear" | "partly_cloudy" | "cloudy" | "fog" | "drizzle"
  | "rain" | "heavy_rain" | "showers" | "violent_showers"
  | "thunderstorm" | "thunderstorm_hail" | "freezing" | "snow";

export type WeatherSeverity = "clear" | "advisory" | "severe";

export type DailyForecast = {
  date: string;
  weatherCode: number;
  conditionKey: WeatherConditionKey;
  severity: WeatherSeverity;
  precipitationProbabilityMax: number | null;
  precipitationSumMm: number | null;
  precipitationHours: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  apparentTemperatureMaxC: number | null;
};

export type GuideForecast = {
  locationName: string;
  latitude: number;
  longitude: number;
  days: DailyForecast[];
  requestedStartDate: string;
  requestedEndDate: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  clampedToHorizon: boolean;
  clampedFromPast: boolean;
  datesWereAssumed: boolean;
  // Weather is a standalone factual question, not part of trip planning -
  // when nothing (a focused place, a confident catalogue match) told us
  // where to check, this defaults to a sensible area instead of blocking
  // on a clarifying question, and says so explicitly rather than silently
  // guessing.
  locationWasAssumed: boolean;
  // Set only when the traveller DID name a place but it matched neither the
  // catalogue nor the free Malaysia city/state table - lets the answer say
  // "I don't recognise X" instead of the more generic "you didn't say
  // where", which would misrepresent what actually happened.
  unrecognizedLocationName: string | null;
  checkedAt: string;
};

// Open-Meteo's free forecast endpoint only guarantees 16 days ahead.
export const FORECAST_HORIZON_DAYS = 16;
// Matches sanitizePlanState's own +6-day cap on a Travel Brief date range.
export const MAX_FORECAST_SPAN_DAYS = 7;

// Same two WMO sets retrieval.ts used to keep locally - moved here so there
// is exactly one server-side copy. WeatherGate.js (a browser module the edge
// function cannot import) keeps its own identical copy.
const SEVERE_CODES = new Set([57, 67, 82, 96, 99]);
const ADVISORY_CODES = new Set([45, 48, 63, 65, 73, 75, 80, 81, 95]);

const CONDITION_BY_CODE: Array<[Set<number>, WeatherConditionKey]> = [
  [new Set([0]), "clear"],
  [new Set([1]), "partly_cloudy"],
  [new Set([2, 3]), "cloudy"],
  [new Set([45, 48]), "fog"],
  [new Set([51, 53, 55]), "drizzle"],
  [new Set([56, 57]), "freezing"],
  [new Set([61, 63]), "rain"],
  [new Set([65]), "heavy_rain"],
  [new Set([66, 67]), "freezing"],
  [new Set([71, 73, 75, 77]), "snow"],
  [new Set([80, 81]), "showers"],
  [new Set([82]), "violent_showers"],
  [new Set([85, 86]), "snow"],
  [new Set([95]), "thunderstorm"],
  [new Set([96, 99]), "thunderstorm_hail"]
];

export function wmoConditionKey(code: number): WeatherConditionKey {
  const match = CONDITION_BY_CODE.find(([codes]) => codes.has(Number(code)));
  return match ? match[1] : "cloudy";
}

export function weatherSeverity(code: number): WeatherSeverity {
  const value = Number(code);
  if (SEVERE_CODES.has(value)) return "severe";
  if (ADVISORY_CODES.has(value)) return "advisory";
  return "clear";
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// Asia/Kuala_Lumpur has no DST and is a fixed UTC+8, but deriving it from
// Intl instead of a hardcoded offset keeps this correct if the runtime's
// tz database ever changes, and matches how the rest of the module already
// requests `timezone=Asia/Kuala_Lumpur` from Open-Meteo.
export function malaysiaToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(now);
}

const validDate = (value: unknown) => /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""));

export function resolveForecastWindow(
  requestedStart: string, requestedEnd: string,
  planStart: string | null, planEnd: string | null, today: string
) {
  let start = validDate(requestedStart) ? requestedStart
    : validDate(planStart) ? String(planStart) : "";
  let end = validDate(requestedEnd) ? requestedEnd
    : validDate(planEnd) ? String(planEnd) : "";
  let datesWereAssumed = false;
  if (!start) {
    start = today;
    end = addDays(today, 2);
    datesWereAssumed = true;
  }
  if (!end || end < start) end = start;

  const horizonEnd = addDays(today, FORECAST_HORIZON_DAYS - 1);
  const entirelyBeyondHorizon = start > horizonEnd;

  let clampedFromPast = false;
  if (start < today) { start = today; clampedFromPast = true; }

  let clampedToHorizon = false;
  if (!entirelyBeyondHorizon && end > horizonEnd) { end = horizonEnd; clampedToHorizon = true; }

  const maxSpanEnd = addDays(start, MAX_FORECAST_SPAN_DAYS - 1);
  if (end > maxSpanEnd) end = maxSpanEnd;

  return { startDate: start, endDate: end, clampedToHorizon, clampedFromPast, datesWereAssumed, entirelyBeyondHorizon };
}

function firstEntry(body: Row) {
  return Array.isArray(body) ? body[0] as Row : body;
}

function numberArray(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map((item) => {
    const parsed = Number(item);
    return Number.isFinite(parsed) ? parsed : null;
  }) : [];
}

export async function fetchGuideForecast(args: {
  latitude: number; longitude: number; locationName: string;
  startDate: string; endDate: string;
  fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<GuideForecast> {
  const { latitude, longitude, locationName, startDate, endDate, fetchImpl = fetch, timeoutMs = 4000 } = args;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude),
      daily: [
        "weather_code", "precipitation_probability_max", "precipitation_sum",
        "precipitation_hours", "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max"
      ].join(","),
      start_date: startDate, end_date: endDate, timezone: "Asia/Kuala_Lumpur"
    });
    const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo forecast ${response.status}`);
    const body = await response.json();
    const entry = firstEntry(body) || {};
    const daily = (entry.daily || {}) as Row;
    const dates = Array.isArray(daily.time) ? daily.time.map(String) : [];
    const codes = numberArray(daily.weather_code);
    const probs = numberArray(daily.precipitation_probability_max);
    const sums = numberArray(daily.precipitation_sum);
    const hours = numberArray(daily.precipitation_hours);
    const tMax = numberArray(daily.temperature_2m_max);
    const tMin = numberArray(daily.temperature_2m_min);
    const apparent = numberArray(daily.apparent_temperature_max);
    const days: DailyForecast[] = dates.map((date, index) => {
      const code = codes[index] ?? 0;
      return {
        date, weatherCode: code, conditionKey: wmoConditionKey(code), severity: weatherSeverity(code),
        precipitationProbabilityMax: probs[index] ?? null, precipitationSumMm: sums[index] ?? null,
        precipitationHours: hours[index] ?? null, temperatureMaxC: tMax[index] ?? null,
        temperatureMinC: tMin[index] ?? null, apparentTemperatureMaxC: apparent[index] ?? null
      };
    });
    return {
      locationName, latitude, longitude, days,
      requestedStartDate: startDate, requestedEndDate: endDate,
      effectiveStartDate: startDate, effectiveEndDate: endDate,
      clampedToHorizon: false, clampedFromPast: false, datesWereAssumed: false,
      locationWasAssumed: false, unrecognizedLocationName: null,
      checkedAt: new Date().toISOString()
    };
  } finally { clearTimeout(timeout); }
}

// A weather question is a standalone factual question, not part of trip
// planning - it should not require a specific catalogue attraction to
// resolve. This is a small, free, static lookup of Malaysia's state
// capitals/major cities (no Geocoding API call, no cost) that the routing
// prompt's weatherRule asks the model to normalise a sub-area/landmark
// down to (e.g. "KLCC" -> "Kuala Lumpur") before this ever runs, so a named
// city that just isn't a specific catalogue venue - "Melaka", "Penang" -
// still resolves to the right place instead of silently defaulting to KL.
type CityEntry = { name: string; state: string; lat: number; lng: number; aliases: string[] };

const MALAYSIA_CITIES: CityEntry[] = [
  { name: "Kuala Lumpur", state: "Kuala Lumpur", lat: 3.1390, lng: 101.6869,
    aliases: ["kuala lumpur", "kl", "吉隆坡", "klcc", "kuala lumpur city centre"] },
  { name: "George Town", state: "Penang", lat: 5.4141, lng: 100.3288,
    aliases: ["george town", "georgetown", "penang", "pulau pinang", "槟城", "檳城", "乔治市", "喬治市"] },
  { name: "Johor Bahru", state: "Johor", lat: 1.4927, lng: 103.7414,
    aliases: ["johor bahru", "jb", "johor", "新山", "柔佛"] },
  { name: "Malacca City", state: "Malacca", lat: 2.1896, lng: 102.2501,
    aliases: ["malacca", "melaka", "malacca city", "马六甲", "馬六甲"] },
  { name: "Ipoh", state: "Perak", lat: 4.5975, lng: 101.0901, aliases: ["ipoh", "perak", "怡保", "霹雳", "霹靂"] },
  { name: "Kota Kinabalu", state: "Sabah", lat: 5.9749, lng: 116.0724,
    aliases: ["kota kinabalu", "kk", "sabah", "亚庇", "亞庇", "沙巴"] },
  { name: "Kuching", state: "Sarawak", lat: 1.5535, lng: 110.3593, aliases: ["kuching", "sarawak", "古晋", "古晉", "砂拉越"] },
  { name: "Alor Setar", state: "Kedah", lat: 6.1214, lng: 100.3679, aliases: ["alor setar", "kedah", "亚罗士打", "亞羅士打", "吉打"] },
  { name: "Kota Bharu", state: "Kelantan", lat: 6.1254, lng: 102.2381, aliases: ["kota bharu", "kelantan", "哥打峇鲁", "哥打峇魯", "吉兰丹", "吉蘭丹"] },
  { name: "Kuantan", state: "Pahang", lat: 3.8168, lng: 103.3260, aliases: ["kuantan", "pahang", "关丹", "關丹", "彭亨"] },
  { name: "Kuala Terengganu", state: "Terengganu", lat: 5.3117, lng: 103.1324,
    aliases: ["kuala terengganu", "terengganu", "瓜拉登嘉楼", "瓜拉登嘉樓", "登嘉楼", "登嘉樓"] },
  { name: "Seremban", state: "Negeri Sembilan", lat: 2.7297, lng: 101.9381,
    aliases: ["seremban", "negeri sembilan", "芙蓉", "森美兰", "森美蘭"] },
  { name: "Shah Alam", state: "Selangor", lat: 3.0733, lng: 101.5185, aliases: ["shah alam", "selangor", "莎阿南", "雪兰莪", "雪蘭莪"] },
  { name: "Putrajaya", state: "Putrajaya", lat: 2.9264, lng: 101.6964, aliases: ["putrajaya", "布城", "布特拉再也"] },
  { name: "Labuan", state: "Labuan", lat: 5.2831, lng: 115.2308, aliases: ["labuan", "纳闽", "納閩"] }
];

function normaliseCityQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function resolveMalaysianCity(name: string): { name: string; state: string; lat: number; lng: number } | null {
  const query = normaliseCityQuery(name);
  if (!query) return null;
  const match = MALAYSIA_CITIES.find((city) => city.aliases.includes(query));
  return match ? { name: match.name, state: match.state, lat: match.lat, lng: match.lng } : null;
}

// Longest alias first so "kuala lumpur" wins over "kl" and "kota kinabalu"
// over "kk" - otherwise a two-letter alias could claim a phrase that names
// the city in full.
const CITY_ALIAS_INDEX = MALAYSIA_CITIES
  .flatMap((city) => city.aliases.map((alias) => ({ alias, city })))
  .sort((a, b) => b.alias.length - a.alias.length);

const LATIN_ALIAS = /^[a-z0-9 ]+$/;

function aliasAppearsIn(query: string, alias: string) {
  // CJK aliases have no word boundaries to respect; a plain substring test is
  // the correct check there. Latin aliases must not match inside a longer
  // word, or "kl" would claim "Klang" and "jb" would claim "Jbeil".
  if (!LATIN_ALIAS.test(alias)) return query.includes(alias);
  const index = query.indexOf(alias);
  if (index < 0) return false;
  const isWordChar = (character: string | undefined) => Boolean(character && /[a-z0-9]/.test(character));
  return !isWordChar(query[index - 1]) && !isWordChar(query[index + alias.length]);
}

// Looser companion to resolveMalaysianCity, for a phrase that *contains* a
// city name rather than being one exactly ("melaka city centre", "somewhere
// around KL"). Deliberately NOT the first thing tried: an exact catalogue
// venue must still win, so index.ts only reaches for this once venue
// matching has already come back ambiguous.
export function matchMalaysianCityInText(text: string): { name: string; state: string; lat: number; lng: number } | null {
  const query = normaliseCityQuery(text);
  if (!query) return null;
  for (const { alias, city } of CITY_ALIAS_INDEX) {
    if (aliasAppearsIn(query, alias)) return { name: city.name, state: city.state, lat: city.lat, lng: city.lng };
  }
  return null;
}

// Used when nothing else resolved a location at all - never a match target.
export const DEFAULT_MALAYSIA_CITY = MALAYSIA_CITIES[0];

export type GeocodedPlace = { name: string; state: string; lat: number; lng: number };

// Number(null) and Number("") are both 0, which is a perfectly finite number
// in the Gulf of Guinea. A missing coordinate has to read as missing, not as
// the equator.
function coordinate(value: unknown) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

// Open-Meteo's geocoding service - the same provider as the forecast above,
// keyless and free, so this adds no cost and no new vendor. It covers towns
// and cities nationwide (GeoNames), which the fifteen hand-written entries
// above never could; those stay as the first, offline tier because they carry
// the local aliases GeoNames does not have ("KL", "馬六甲", "KLCC") and answer
// instantly with no network call.
//
// Town/city level only - it will not find a mall or a single landmark. That is
// the boundary where a paid Google lookup would be required, and is why the
// routing prompt asks the model to normalise a landmark down to its city
// before it ever reaches here.
export async function geocodeMalaysianPlace(name: string, args: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}): Promise<GeocodedPlace | null> {
  const query = String(name || "").trim();
  if (!query) return null;
  const { fetchImpl = fetch, timeoutMs = 2500 } = args;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const search = new URLSearchParams({
      name: query, count: "10", language: "en", format: "json", countryCode: "MY"
    });
    const response = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?${search}`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const results = Array.isArray((body as Row)?.results) ? (body as Row).results as Row[] : [];
    // countryCode is also sent as a query filter, but the response is what
    // decides: a place outside Malaysia must never become a Malaysian
    // traveller's forecast just because the name matched somewhere abroad.
    const match = results.find((row) => String(row?.country_code || "").toUpperCase() === "MY"
      && !Number.isNaN(coordinate(row?.latitude)) && !Number.isNaN(coordinate(row?.longitude)));
    if (!match) return null;
    return {
      name: String(match.name || query), state: String(match.admin1 || ""),
      lat: coordinate(match.latitude), lng: coordinate(match.longitude)
    };
  } catch {
    // A resolution tier, not the answer - a lookup failure must fall through
    // to the next tier, never abort the turn the way a forecast failure does.
    return null;
  } finally { clearTimeout(timeout); }
}
