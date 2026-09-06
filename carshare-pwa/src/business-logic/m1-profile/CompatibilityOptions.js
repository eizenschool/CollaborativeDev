export const VEHICLE_TYPE_OPTIONS = Object.freeze([
  { value: 'sedan', label: 'Sedan' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'suv', label: 'SUV' },
  { value: 'mpv', label: 'MPV' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'van', label: 'Van' },
  { value: 'other', label: 'Other' }
]);

export const SPOKEN_LANGUAGE_OPTIONS = Object.freeze([
  { value: 'malay', label: 'Malay' },
  { value: 'english', label: 'English' },
  { value: 'mandarin', label: 'Mandarin' },
  { value: 'cantonese', label: 'Cantonese' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'other', label: 'Other' }
]);

const VEHICLE_TYPES = new Set(VEHICLE_TYPE_OPTIONS.map((option) => option.value));
const SPOKEN_LANGUAGES = new Set(SPOKEN_LANGUAGE_OPTIONS.map((option) => option.value));

function normalizedValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeVehicleType(value) {
  const normalized = normalizedValue(value);
  return VEHICLE_TYPES.has(normalized) ? normalized : '';
}

export function normalizeSpokenLanguage(value) {
  const normalized = normalizedValue(value);
  return SPOKEN_LANGUAGES.has(normalized) ? normalized : '';
}

export function normalizeSpokenLanguages(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeSpokenLanguage).filter(Boolean))];
}

export function vehicleTypeLabel(value) {
  return VEHICLE_TYPE_OPTIONS.find((option) => option.value === value)?.label || '';
}

export function spokenLanguageLabel(value) {
  return SPOKEN_LANGUAGE_OPTIONS.find((option) => option.value === value)?.label || '';
}
