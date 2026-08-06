// ===== PRESENTATION LAYER (Icon set) =====
// A single, consistent outline icon set used everywhere emoji used to appear.
// Hand-crafted SVGs (no extra dependency) — 24x24 viewBox, 1.8 stroke, currentColor,
// so every icon inherits whatever text color it sits in and scales with `size`.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} {...base} {...rest}>
      {children}
    </svg>
  );
}

export function IconCar(props) {
  return (
    <Svg {...props}>
      <path d="M4 16V11.5L6 7h12l2 4.5V16" />
      <path d="M3.5 16h17v2.5a1 1 0 0 1-1 1H17a1 1 0 0 1-1-1V17H8v1.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V16Z" />
      <circle cx="7.5" cy="16" r="1.3" />
      <circle cx="16.5" cy="16" r="1.3" />
    </Svg>
  );
}

export function IconSettings(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.3-1.5-2.6-2.2.7a7.7 7.7 0 0 0-2.6-1.5L14.6 3h-3l-.4 2.3a7.7 7.7 0 0 0-2.6 1.5l-2.2-.7-1.5 2.6 1.9 1.3a7.6 7.6 0 0 0 0 3l-1.9 1.3 1.5 2.6 2.2-.7c.76.66 1.64 1.17 2.6 1.5L11.6 21h3l.4-2.3a7.7 7.7 0 0 0 2.6-1.5l2.2.7 1.5-2.6-1.9-1.3Z" />
    </Svg>
  );
}

export function IconStar(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l2.5 5.4 5.8.6-4.3 4 1.2 5.8L12 16.3l-5.2 3 1.2-5.8-4.3-4 5.8-.6L12 3.5Z" />
    </Svg>
  );
}

export function IconChart(props) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  );
}

export function IconUser(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1-3.6 4-5.5 7-5.5s6 1.9 7 5.5" />
    </Svg>
  );
}

export function IconMail(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </Svg>
  );
}

export function IconPhone(props) {
  return (
    <Svg {...props}>
      <path d="M6.6 3.5h3l1.4 4.4-2.2 1.6a12.7 12.7 0 0 0 5.7 5.7l1.6-2.2 4.4 1.4v3a1.7 1.7 0 0 1-1.8 1.7A16.7 16.7 0 0 1 4.9 5.3a1.7 1.7 0 0 1 1.7-1.8Z" />
    </Svg>
  );
}

export function IconLock(props) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
      <circle cx="12" cy="15" r="1.3" />
    </Svg>
  );
}

export function IconHeart(props) {
  return (
    <Svg {...props}>
      <path d="M12 20.2S3.8 15.3 3.8 9.4a4.6 4.6 0 0 1 8.2-2.8 4.6 4.6 0 0 1 8.2 2.8c0 5.9-8.2 10.8-8.2 10.8Z" />
    </Svg>
  );
}

export function IconEye(props) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  );
}

export function IconEyeOff(props) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5l17 17" />
      <path d="M10.6 5.7A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-3.4 4.1M6.9 6.9C4.4 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.3 0 2.5-.3 3.6-.8" />
      <path d="M9.7 9.7a2.6 2.6 0 0 0 3.6 3.6" />
    </Svg>
  );
}

export function IconSave(props) {
  return (
    <Svg {...props}>
      <path d="M5 3.5h11l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 19V5A1.5 1.5 0 0 1 4.5 3.5H5Z" />
      <path d="M8 3.5V8h7V3.5M7.5 20v-6h9v6" />
    </Svg>
  );
}

export function IconCheck(props) {
  return (
    <Svg {...props}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Svg>
  );
}

export function IconCheckCircle(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.7 2.7L16.3 9" />
    </Svg>
  );
}

export function IconTrendUp(props) {
  return (
    <Svg {...props}>
      <path d="M3.5 16.5 10 10l4 4 6.5-6.5" />
      <path d="M15 7.5h5.5V13" />
    </Svg>
  );
}

export function IconTrendDown(props) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5 10 14l4-4 6.5 6.5" />
      <path d="M15 16.5h5.5V11" />
    </Svg>
  );
}

export function IconBolt(props) {
  return (
    <Svg {...props}>
      <path d="M12.5 2.5 5 13.5h5.5L11 21.5l7.5-11.5H13L12.5 2.5Z" />
    </Svg>
  );
}

export function IconLeaf(props) {
  return (
    <Svg {...props}>
      <path d="M20 4c-9 0-14.5 5-14.5 12.5C13 16.5 20 11.5 20 4Z" />
      <path d="M6 19c3-3.5 6-6.5 12.5-13.5" />
    </Svg>
  );
}

export function IconMedal(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="14.5" r="5.2" />
      <path d="M9.6 9.8 7 3h3l2 4.6L14 3h3l-2.6 6.8" />
      <path d="M12 12v5" />
    </Svg>
  );
}

export function IconEdit(props) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14 5.5 18.5 10" />
    </Svg>
  );
}

export function IconTrash(props) {
  return (
    <Svg {...props}>
      <path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6.5 7 7.3 19a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconPause(props) {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13M16 5.5v13" />
    </Svg>
  );
}

export function IconPlay(props) {
  return (
    <Svg {...props}>
      <path d="M6.5 4.5v15l13-7.5-13-7.5Z" />
    </Svg>
  );
}

export function IconArrowRight(props) {
  return (
    <Svg {...props}>
      <path d="M4 12h16M13.5 5.5 20 12l-6.5 6.5" />
    </Svg>
  );
}

export function IconPlus(props) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconLayers(props) {
  return (
    <Svg {...props}>
      <path d="M12 3 3 8l9 5 9-5Z" />
      <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
    </Svg>
  );
}

export function IconShield(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 19 6.5V12c0 5-3 8-7 9.5C8 20 5 17 5 12V6.5Z" />
    </Svg>
  );
}

export function IconHome(props) {
  return (
    <Svg {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h5v-5h2v5h5v-9" />
    </Svg>
  );
}

export function IconMessage(props) {
  return (
    <Svg {...props}>
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4Z" />
    </Svg>
  );
}

export function IconRoute(props) {
  return (
    <Svg {...props}>
      <path d="M5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M19 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M7 16.6C11 13 13 11 17.2 8" />
    </Svg>
  );
}

export function IconAlertTriangle(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 9.5v5" />
      <circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSearch(props) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </Svg>
  );
}

export function IconBell(props) {
  return (
    <Svg {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconLogOut(props) {
  return (
    <Svg {...props}>
      <path d="M13.5 3.5H6A1.5 1.5 0 0 0 4.5 5v14A1.5 1.5 0 0 0 6 20.5h7.5" />
      <path d="M10.5 12h10M17 8.2 20.8 12 17 15.8" />
    </Svg>
  );
}

export function IconUsers(props) {
  return (
    <Svg {...props}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.8 19c.8-3.2 3.2-5 5.7-5s4.9 1.8 5.7 5" />
      <circle cx="16.5" cy="8.5" r="2.5" />
      <path d="M15 11.2c1.9.4 3.6 2 4.2 4.3" />
    </Svg>
  );
}

export function IconMapPin(props) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-6.4 7-11.5A7 7 0 0 0 5 9.5C5 14.6 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </Svg>
  );
}

export function IconFilter(props) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M7.5 12h9M10.5 18h3" />
    </Svg>
  );
}

export function IconCalendar(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function IconArrowLeft(props) {
  return (
    <Svg {...props}>
      <path d="M20 12H4M10.5 5.5 4 12l6.5 6.5" />
    </Svg>
  );
}

export function IconX(props) {
  return (
    <Svg {...props}>
      <path d="M5 5l14 14M19 5 5 19" />
    </Svg>
  );
}

export function IconCamera(props) {
  return (
    <Svg {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.3" />
    </Svg>
  );
}
