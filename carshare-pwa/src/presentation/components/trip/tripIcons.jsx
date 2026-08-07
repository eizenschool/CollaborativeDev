// ===== PRESENTATION LAYER (Module 5 icon set) =====
// Small, self-contained icon set for the Trip Management & Eco Impact
// module. Kept separate from the shared src/presentation/components/icons.jsx
// so this module doesn't need to touch a file other teammates are actively
// editing - fine to merge any of these into the shared icon set later.
import React from 'react';

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

function Svg({ size = 24, children, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...props}>
      {children}
    </svg>
  );
}

export function IconLeafSmall(props) {
  return (
    <Svg {...props}>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 3c.3 8.5-2.8 12.7-8 17z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 11 13 11 11" />
    </Svg>
  );
}

export function IconRoadSmall(props) {
  return (
    <Svg {...props}>
      <path d="M4 21 9 3h6l5 18" />
      <path d="M12 3v3M12 10v2M12 16v2" />
    </Svg>
  );
}

export function IconUsersSmall(props) {
  return (
    <Svg {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}

export function IconChevronLeftSmall(props) {
  return (
    <Svg {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

export function IconChevronRightSmall(props) {
  return (
    <Svg {...props}>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

export function IconArrowLeftSmall(props) {
  return (
    <Svg {...props}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </Svg>
  );
}

export function IconTrophySmall(props) {
  return (
    <Svg {...props}>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4a3 3 0 0 0 3 3M17 5h3a3 3 0 0 1-3 3" />
    </Svg>
  );
}

export function IconMapPinSmall(props) {
  return (
    <Svg {...props}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}