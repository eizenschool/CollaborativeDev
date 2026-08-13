// ===== PRESENTATION LAYER (PlacePoster) =====
// FR-6.17 - the category illustration tier.
//
// This is not a stand-in for missing work: the data-sufficiency tiers require an
// illustration wherever a place has neither a photograph nor Street View
// coverage, and the fixture catalogue holds photo *references* rather than
// fetchable images (storing Google image bytes is not permitted). When the live
// catalogue lands, real photographs render in the same slots and this drops to
// being the last fallback it was always specified to be.
//
// Each poster is generated from a hash of the place id, so a place looks the same
// on every render and on every device, while no two places look alike. Flat
// geometric travel-poster style, built entirely from the green design system.

import { CATEGORY } from '../../../business-logic/discovery/constants.js';

/**
 * FNV-1a. Small, dependency-free, and well spread for short strings - the point
 * is that "p_cameron" and "p_jonker" land far apart so their posters differ
 * visibly, not cryptographic strength.
 */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random stream from one seed. */
function rng(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

// Illustration-only palettes. UI.md permits module-local values with a concrete
// reason: illustration needs mid-tones and sky washes that the semantic UI tokens
// (which exist for text, borders and states) do not provide. Every ramp is
// anchored on the shared green so the artwork reads as part of this product.
const PALETTES = {
  [CATEGORY.NATURE]: {
    sky: ['#dcfce7', '#bbf7d0'],
    layers: ['#4ade80', '#22c55e', '#16a34a', '#15803d'],
    accent: '#fde68a'
  },
  [CATEGORY.HERITAGE]: {
    sky: ['#fef9c3', '#fde68a'],
    layers: ['#86efac', '#34d399', '#0d9488', '#134e4a'],
    accent: '#fbbf24'
  },
  [CATEGORY.CULINARY]: {
    sky: ['#fef3c7', '#fed7aa'],
    layers: ['#fb923c', '#f97316', '#15803d', '#134e4a'],
    accent: '#fbbf24'
  },
  [CATEGORY.EVENT]: {
    sky: ['#ccfbf1', '#99f6e4'],
    layers: ['#5eead4', '#2dd4bf', '#0d9488', '#115e59'],
    accent: '#fbbf24'
  }
};

const W = 400;
const H = 240;

/** Layered ridgelines. The workhorse for nature, and the far background elsewhere. */
function ridge(next, baseY, amplitude, fill, key) {
  const points = [];
  for (let x = 0; x <= W; x += W / 6) {
    points.push(`${x},${Math.round(baseY - next() * amplitude)}`);
  }
  return <polygon key={key} points={`0,${H} ${points.join(' ')} ${W},${H}`} fill={fill} />;
}

function NatureScene({ next, palette }) {
  return (
    <>
      <circle cx={W * (0.2 + next() * 0.6)} cy={46 + next() * 24} r={22 + next() * 10} fill={palette.accent} opacity="0.9" />
      {ridge(next, 168, 46, palette.layers[0], 'r1')}
      {ridge(next, 196, 40, palette.layers[1], 'r2')}
      {ridge(next, 222, 32, palette.layers[2], 'r3')}
      <rect x="0" y={H - 26} width={W} height="26" fill={palette.layers[3]} />
    </>
  );
}

/** Shophouse facades: the visual signature of a Malaysian heritage street. */
function HeritageScene({ next, palette }) {
  const houses = [];
  let x = 8;
  let index = 0;
  while (x < W - 20) {
    const width = 46 + next() * 28;
    const top = 108 + next() * 42;
    houses.push(
      <g key={`h${index}`}>
        <rect x={x} y={top} width={width} height={H - top} fill={palette.layers[index % 2 === 0 ? 2 : 3]} />
        <rect x={x + width * 0.2} y={top + 18} width={width * 0.24} height="22" rx="6" fill={palette.sky[0]} opacity="0.75" />
        <rect x={x + width * 0.56} y={top + 18} width={width * 0.24} height="22" rx="6" fill={palette.sky[0]} opacity="0.75" />
        <rect x={x - 3} y={top - 7} width={width + 6} height="9" rx="3" fill={palette.layers[1]} />
      </g>
    );
    x += width + 5;
    index += 1;
  }
  return (
    <>
      <circle cx={W * 0.78} cy="52" r="26" fill={palette.accent} opacity="0.85" />
      {ridge(next, 138, 30, palette.layers[0], 'bg')}
      {houses}
    </>
  );
}

/** Market stalls with awnings, steam and lanterns. */
function CulinaryScene({ next, palette }) {
  const stalls = [];
  let x = 14;
  let index = 0;
  while (x < W - 40) {
    const width = 74 + next() * 30;
    const top = 128 + next() * 26;
    stalls.push(
      <g key={`s${index}`}>
        <path d={`M${x - 8},${top} L${x + width + 8},${top} L${x + width},${top + 16} L${x},${top + 16} Z`}
          fill={index % 2 === 0 ? palette.layers[0] : palette.layers[1]} />
        <rect x={x} y={top + 16} width={width} height={H - top - 16} fill={palette.layers[2]} />
        <rect x={x + 10} y={top + 30} width={width - 20} height="12" rx="4" fill={palette.sky[0]} opacity="0.55" />
      </g>
    );
    x += width + 12;
    index += 1;
  }
  return (
    <>
      {[0.16, 0.44, 0.72].map((position, i) => (
        <g key={`l${i}`}>
          <line x1={W * position} y1="0" x2={W * position} y2={44 + i * 6} stroke={palette.layers[3]} strokeWidth="2" opacity="0.4" />
          <ellipse cx={W * position} cy={54 + i * 6} rx="11" ry="14" fill={palette.accent} opacity="0.95" />
        </g>
      ))}
      {stalls}
      <rect x="0" y={H - 16} width={W} height="16" fill={palette.layers[3]} />
    </>
  );
}

/** Festival stage: canopy, flags and lights. */
function EventScene({ next, palette }) {
  const flags = [];
  for (let i = 0; i < 9; i += 1) {
    const fx = 20 + i * ((W - 40) / 8);
    flags.push(
      <polygon key={`f${i}`}
        points={`${fx},34 ${fx + 15},41 ${fx},50`}
        fill={i % 2 === 0 ? palette.accent : palette.layers[1]} />
    );
  }
  const stageTop = 132 + next() * 18;
  return (
    <>
      <path d={`M8,36 Q${W / 2},${58 + next() * 14} ${W - 8},36`} stroke={palette.layers[2]} strokeWidth="2" fill="none" />
      {flags}
      {ridge(next, 150, 26, palette.layers[0], 'bg')}
      <path d={`M${W * 0.16},${stageTop} L${W * 0.5},${stageTop - 40} L${W * 0.84},${stageTop} Z`} fill={palette.layers[1]} />
      <rect x={W * 0.16} y={stageTop} width={W * 0.68} height={H - stageTop} fill={palette.layers[2]} />
      <rect x="0" y={H - 20} width={W} height="20" fill={palette.layers[3]} />
      {[0.3, 0.5, 0.7].map((position, i) => (
        <circle key={`d${i}`} cx={W * position} cy={stageTop + 30} r="6" fill={palette.accent} opacity="0.9" />
      ))}
    </>
  );
}

const SCENES = {
  [CATEGORY.NATURE]: NatureScene,
  [CATEGORY.HERITAGE]: HeritageScene,
  [CATEGORY.CULINARY]: CulinaryScene,
  [CATEGORY.EVENT]: EventScene
};

/**
 * @param {string} seed      usually the place id - identical seeds render identically
 * @param {string} category  chooses the composition and palette
 * @param {number} variant   nudges the seed, so a carousel can show several frames
 *                           of the same place without repeating one image
 */
export default function PlacePoster({ seed = '', category = CATEGORY.NATURE, variant = 0, className = '' }) {
  const palette = PALETTES[category] || PALETTES[CATEGORY.NATURE];
  const Scene = SCENES[category] || NatureScene;
  const next = rng(hash(`${seed}::${variant}`));
  const gradientId = `poster-${hash(`${seed}::${variant}::grad`)}`;

  return (
    <svg
      className={`dsc-poster ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${category} illustration`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.sky[0]} />
          <stop offset="100%" stopColor={palette.sky[1]} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${gradientId})`} />
      <Scene next={next} palette={palette} />
    </svg>
  );
}

// Exported for the determinism test; not part of the rendering contract.
export const __posterInternals = { hash, rng, PALETTES };
