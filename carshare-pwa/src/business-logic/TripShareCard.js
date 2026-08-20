// ===== BUSINESS LOGIC LAYER (TripShareCard) =====
// Module 5 - the shareable monthly impact card (FR-5.9).
//
// This module decides WHAT the card says, which palettes it can wear, and
// where it can be sent. Drawing it is the presentation layer's job
// (ShareReportDialog.jsx), so wording, palettes and link building stay
// testable without a canvas.

import { KG_PER_TREE_YEAR } from './TripAchievements.js';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Every palette keeps white text, so contrast holds without a per-theme
// foreground. `from`/`to` drive the card's diagonal gradient; `swatch` is what
// the picker shows.
export const CARD_THEMES = [
  { id: 'forest', name: 'Forest', from: '#16A34A', to: '#0D9488', swatch: '#16A34A' },
  { id: 'ocean', name: 'Ocean', from: '#0EA5E9', to: '#2563EB', swatch: '#0EA5E9' },
  { id: 'sunset', name: 'Sunset', from: '#F59E0B', to: '#EF4444', swatch: '#F59E0B' },
  { id: 'orchid', name: 'Orchid', from: '#7C3AED', to: '#DB2777', swatch: '#7C3AED' },
  { id: 'midnight', name: 'Midnight', from: '#1E293B', to: '#0F172A', swatch: '#1E293B' }
];

export const DEFAULT_THEME_ID = CARD_THEMES[0].id;

export function themeById(id) {
  return CARD_THEMES.find((theme) => theme.id === id) || CARD_THEMES[0];
}

// A month with no completed trips has nothing to boast about, so the caller
// hides the entry point rather than producing an empty card.
export function canShareReport(report) {
  return Boolean(report && report.hasData && report.completedTrips > 0);
}

export function treesEquivalent(carbonKg) {
  return Math.max(0, Math.round((carbonKg || 0) / KG_PER_TREE_YEAR));
}

function stat(value, label) {
  return { value: String(value), label };
}

export function buildShareContent(report, { userName = '' } = {}) {
  if (!canShareReport(report)) return null;

  const monthLabel = `${MONTH_NAMES[report.month]} ${report.year}`;
  const carbon = report.totalCarbonSavedKg;
  const trees = treesEquivalent(carbon);
  const tripWord = report.completedTrips === 1 ? 'trip' : 'trips';

  return {
    monthLabel,
    headline: `${carbon}`,
    headlineUnit: 'kg CO₂ saved',
    stats: [
      stat(report.completedTrips, `shared ${tripWord}`),
      stat(`${report.totalDistanceKm} km`, 'travelled together'),
      stat(report.passengersCarried, report.passengersCarried === 1 ? 'passenger carried' : 'passengers carried')
    ],
    // Only claim the tree comparison when it rounds to at least one, otherwise
    // the card would read "0 trees" and undersell a real saving.
    footnote: trees > 0
      ? `That's about ${trees} ${trees === 1 ? 'tree' : 'trees'} working for a year.`
      : 'Every shared seat keeps a car off the road.',
    byline: userName ? `${userName} · Let's Tumpang` : "Let's Tumpang",
    shareText:
      `I saved ${carbon} kg of CO₂ in ${monthLabel} by carpooling on Let's Tumpang` +
      ` - ${report.completedTrips} shared ${tripWord}, ${report.totalDistanceKm} km together.`,
    shareTitle: `My ${monthLabel} eco impact`,
    filename: `lets-tumpang-impact-${report.year}-${String(report.month + 1).padStart(2, '0')}.png`
  };
}

// Web share links carry text only - no social network accepts an image through
// a plain URL. These are listed as "post the text, paste the image" rather than
// pretending the picture travels with them; Instagram, Messenger and Facebook
// have no such link at all and are reached through the device share sheet.
export function buildTextShareTargets(content) {
  if (!content) return [];
  const text = encodeURIComponent(content.shareText);
  return [
    { id: 'whatsapp', label: 'WhatsApp', brand: '#25D366', href: `https://wa.me/?text=${text}` },
    { id: 'telegram', label: 'Telegram', brand: '#229ED9', href: `https://t.me/share/url?url=${text}` },
    { id: 'x', label: 'X', brand: '#111827', href: `https://twitter.com/intent/tweet?text=${text}` }
  ];
}
