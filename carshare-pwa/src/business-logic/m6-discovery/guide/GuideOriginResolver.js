// Deterministic first tier for the Guide's origin resolver. It covers the
// Malaysian city aliases already used by the product; the live Edge path adds
// the existing free geocoder for names outside this compact list.
const KNOWN_ORIGINS = Object.freeze([
  { label: 'Kuala Lumpur', aliases: ['kuala lumpur', 'kl'], state: 'Kuala Lumpur', lat: 3.139, lng: 101.6869 },
  { label: 'Johor Bahru', aliases: ['johor bahru', 'jb'], state: 'Johor', lat: 1.4927, lng: 103.7414 },
  { label: 'George Town', aliases: ['george town', 'georgetown', 'penang'], state: 'Penang', lat: 5.4141, lng: 100.3288 },
  { label: 'Melaka', aliases: ['melaka', 'malacca'], state: 'Melaka', lat: 2.1896, lng: 102.2501 },
  { label: 'Ipoh', aliases: ['ipoh'], state: 'Perak', lat: 4.5975, lng: 101.0901 },
  { label: 'Kota Kinabalu', aliases: ['kota kinabalu', 'kk'], state: 'Sabah', lat: 5.9749, lng: 116.0724 },
  { label: 'Kuching', aliases: ['kuching'], state: 'Sarawak', lat: 1.5535, lng: 110.3593 },
  { label: 'Kuala Terengganu', aliases: ['kuala terengganu'], state: 'Terengganu', lat: 5.3117, lng: 103.1324 },
  { label: 'Kuantan', aliases: ['kuantan'], state: 'Pahang', lat: 3.8168, lng: 103.326 },
  { label: 'Kota Bharu', aliases: ['kota bharu'], state: 'Kelantan', lat: 6.1254, lng: 102.2381 },
  { label: 'Kangar', aliases: ['kangar', 'perlis'], state: 'Perlis', lat: 6.4414, lng: 100.1986 },
  { label: 'Labuan', aliases: ['labuan'], state: 'Labuan', lat: 5.2831, lng: 115.2308 },
  { label: 'Putrajaya', aliases: ['putrajaya'], state: 'Putrajaya', lat: 2.9264, lng: 101.6964 },
  { label: 'Seremban', aliases: ['seremban'], state: 'Negeri Sembilan', lat: 2.7258, lng: 101.9424 }
]);

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim();
}

export function guideOriginCandidates(value) {
  const query = normalize(value);
  if (!query) return [];
  return KNOWN_ORIGINS.filter((origin) => origin.aliases.some((alias) => normalize(alias) === query))
    .map(({ aliases, ...origin }) => ({ ...origin }));
}

export function resolveKnownGuideOrigin(value) {
  const candidates = guideOriginCandidates(value);
  return candidates.length === 1 ? candidates[0] : null;
}

export const GuideOriginResolver = { guideOriginCandidates, resolveKnownGuideOrigin };
