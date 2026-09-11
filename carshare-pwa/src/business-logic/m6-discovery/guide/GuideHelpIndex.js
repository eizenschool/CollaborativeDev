// ===== BUSINESS LOGIC LAYER (Tumpang Guide verified Help fixture) =====
// Production stores versioned four-language sections with pgvector. This
// deterministic keyword index is the offline fallback and the test oracle.

export const GUIDE_HELP_SECTIONS = Object.freeze([
  {
    id: 'discover', version: 1,
    keywords: ['discover', 'destination', 'recommend', '探索', '推荐', 'cadangan', 'tempat', 'பரிந்துரை', 'இடம்'],
    text: 'Open Discover to browse database places. Tumpang Guide narrows the same catalogue conversationally; Why this opens the full destination page.'
  },
  {
    id: 'ride-search', version: 1,
    keywords: ['search', 'find ride', 'seat', '搜寻', '找车', 'carian', 'cari ride', 'தேடு', 'ride'],
    text: 'After choosing a destination, Find a ride opens Search with the destination, date and catalogue Place ID prefilled.'
  },
  {
    id: 'ride-alert', version: 1,
    keywords: ['alert', 'notification', 'no ride', '通知', '提醒', 'amaran', 'pemberitahuan', 'அறிவிப்பு'],
    text: 'If nobody is driving there, a signed-in user can confirm a Ride availability alert for that destination and date.'
  },
  {
    id: 'preferences', version: 1,
    keywords: ['preference', 'history', 'personal', '偏好', '历史', 'pilihan', 'sejarah', 'விருப்பம்', 'வரலாறு'],
    text: 'Travel preferences can be saved only after confirmation. Trip History is read only when you switch on consent for the current Guide session.'
  },
  {
    id: 'privacy', version: 1,
    keywords: ['privacy', 'save chat', 'delete', '隐私', '删除', 'privasi', 'padam', 'தனியுரிமை', 'நீக்கு'],
    text: 'Guest chats are not saved. Signed-in Guide chats are private, can be deleted, and are automatically removed after 90 days.'
  }
]);

export function searchGuideHelp(query, limit = 3) {
  const terms = String(query || '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
  return GUIDE_HELP_SECTIONS.map((section) => ({
    ...section,
    score: section.keywords.reduce((score, keyword) => score + (terms.some((term) => keyword.toLocaleLowerCase().includes(term) || term.includes(keyword.toLocaleLowerCase())) ? 1 : 0), 0)
  })).filter((section) => section.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

