// Design tokens for Module 5 - mirrors the palette already defined in the
// Module 2 design doc (figma-prompt-ride-sharing-pwa.md) so colors stay
// consistent across modules. Kept local to this folder rather than editing
// a shared theme/constants file other teammates may be touching.

export const COLORS = {
  primary: '#16A34A',
  primaryDark: '#15803D',
  primaryTint: '#DCFCE7',
  teal: '#0D9488',
  tealTint: '#CCFBF1',
  bg: '#F6FAF7',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6'
};

export const STATUS_COLORS = {
  Draft: { text: '#9CA3AF', bg: '#F3F4F6' },
  Published: { text: '#3B82F6', bg: '#DBEAFE' },
  Matched: { text: '#7C3AED', bg: '#EDE9FE' },
  'In Transit': { text: '#F59E0B', bg: '#FEF3C7' },
  Completed: { text: '#16A34A', bg: '#DCFCE7' },
  Cancelled: { text: '#EF4444', bg: '#FEE2E2' },
  // Published, nobody joined, departure passed - Module 2's lifecycle job
  // sets this. Distinct from Cancelled: nothing went wrong, it just lapsed.
  Expired: { text: '#78716C', bg: '#F5F5F4' }
};

export const TIER_COLORS = {
  'Bronze Host': '#CD7F32',
  'Silver Host': '#9CA3AF',
  'Gold Host': '#EAB308',
  'Platinum Host': '#0EA5E9'
};