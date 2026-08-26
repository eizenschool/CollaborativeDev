// ===== PRESENTATION LAYER (Module 5 scenes) =====
// The module's small illustrations, and the two pieces they share: the car
// drawing and the loop that walks it along a path.
//
// They live together because the car is drawn in three places and a car that
// is subtly different on each screen reads as three different apps. The same
// reason the path-following borrows AuthPage.jsx's technique rather than
// inventing a second one.
//
// House rules for everything in here:
//   - Scenes go where a screen is EMPTY or FINISHED, never above live figures.
//     A picture that pushes the numbers down the page is decoration at the user.
//   - Anything countable in a scene is real. The trees on the Impact strip are
//     the trees actually earned; the empty roadside is genuinely empty.
//   - NEVER put an animating class on an element that also carries a transform
//     ATTRIBUTE. A CSS transform replaces the attribute outright, so the thing
//     animates from the origin instead of from where it was placed. Split it:
//     an outer <g> positions, an inner <g> animates.
//   - Widths are capped. An SVG left at width:100% will happily become 165px
//     tall in a wide desktop column, which is how a strip turns into a
//     billboard.
import React, { useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Drawn around its own centre so a rotation applied by the caller pivots on the
// car rather than swinging it around a corner.
export function CarShape({ scale = 1 }) {
  return (
    <g transform={`scale(${scale}) translate(-7 -5.5)`}>
      <path d="M2.8 4.2 L4.6 1.4 H9.8 L11.6 4.2 Z" fill="var(--teal-dark)" />
      <rect x="0.4" y="3.9" width="13.6" height="4.8" rx="2.2" fill="var(--teal)" />
      <circle cx="3.9" cy="8.8" r="1.6" fill="#1F2937" />
      <circle cx="10.5" cy="8.8" r="1.6" fill="#1F2937" />
    </g>
  );
}

// Leaves off the back, not exhaust - the whole point of the trip.
export function LeafPuffs({ x = -10, y = -1 }) {
  return (
    <g aria-hidden="true">
      <circle className="m5-puff" style={{ '--m5-delay': '0ms' }} cx={x} cy={y} r="1.7" fill="var(--teal-dark)" />
      <circle className="m5-puff" style={{ '--m5-delay': '620ms' }} cx={x} cy={y} r="1.3" fill="var(--teal-dark)" />
    </g>
  );
}

// Walks `carRef` along `roadRef`, facing the direction of travel.
//
// The car is placed by writing a transform ATTRIBUTE. It must never be a CSS
// transform: the two set the same property and CSS wins, which would pin every
// car at the origin.
export function useRoadRunner(roadRef, carRef, { lapMs = 13000, resting = 0.32, drive = true } = {}) {
  useEffect(() => {
    const road = roadRef.current;
    const car = carRef.current;
    if (!road || !car) return undefined;

    const length = road.getTotalLength();

    function place(progress) {
      const distance = length * progress;
      const point = road.getPointAtLength(distance);
      // Two samples either side give the tangent, so the car leans into the
      // bends instead of sliding along flat.
      const before = road.getPointAtLength(Math.max(0, distance - 1));
      const after = road.getPointAtLength(Math.min(length, distance + 1));
      const angle = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
      car.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle})`);
    }

    // Park it first. This is also what a viewer sees when animation frames never
    // arrive - a backgrounded tab, or a browser that is not compositing - rather
    // than a car stuck off the left edge.
    place(resting);
    if (!drive || prefersReducedMotion()) return undefined;

    let frame = null;
    const startedAt = performance.now();

    function tick(now) {
      // Constant speed: the seam of the loop happens off-canvas, so there is
      // nothing to ease into or out of.
      place(((now - startedAt) % lapMs) / lapMs);
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [roadRef, carRef, lapMs, resting, drive]);
}

// ------------------------------------------------------------------ //
// History, before there is any history: a car waiting at the kerb.
// Nothing is counted here, so nothing pretends to be.
// ------------------------------------------------------------------ //
export function RoadsideWaiting() {
  return (
    <div className="m5-scene m5-scene-waiting">
      <svg className="m5-scene-art" viewBox="0 0 300 68" role="img" aria-label="A car waiting at the kerb for its first trip.">
        <path d="M0 52 H300" stroke="var(--teal-tint)" strokeWidth="9" strokeLinecap="round" />
        <path d="M8 52 H292" stroke="#FFFFFF" strokeWidth="1.6" strokeDasharray="7 10" strokeLinecap="round" />

        {/* A stop post, so the car reads as waiting rather than stranded. */}
        <g className="m5-scene-post">
          <rect x="232" y="24" width="2.4" height="26" rx="1" fill="var(--teal-dark)" opacity="0.55" />
          <rect x="222" y="18" width="23" height="12" rx="3" fill="var(--teal)" opacity="0.85" />
          <circle cx="233.5" cy="24" r="2.6" fill="#FFFFFF" opacity="0.9" />
        </g>

        <g transform="translate(96 44)">
          <g className="m5-scene-idle">
            <CarShape scale={1.35} />
            {/* Indicator: it is waiting for someone, and says so. */}
            <circle className="m5-blink" cx="10" cy="-1.5" r="1.8" fill="#F59E0B" />
          </g>
        </g>

        <g transform="translate(46 52)">
          <SmallTree />
        </g>
        <g transform="translate(272 52)">
          <SmallTree />
        </g>
      </svg>
    </div>
  );
}

function SmallTree({ scale = 1 }) {
  return (
    <g opacity="0.55" transform={`scale(${scale})`}>
      <rect x="-1" y="-5" width="2" height="5.4" rx="0.9" fill="#92400E" />
      <circle cx="0" cy="-9.4" r="4.2" fill="var(--teal)" />
      <circle cx="-2.8" cy="-6.4" r="3.1" fill="var(--teal-dark)" opacity="0.8" />
      <circle cx="2.8" cy="-6.4" r="3.1" fill="var(--teal-dark)" opacity="0.65" />
    </g>
  );
}

// ------------------------------------------------------------------ //
// The crowd along the foot of the leaderboard arena: supporters at each side
// and a car lapping the lane between them.
//
// THREE PIECES, NOT ONE SVG. A single strip spanning the arena would be
// scaled by its own aspect ratio, and a 5.5:1 viewBox in a 780px column comes
// out 141px tall - a billboard again. Fixed-size SVGs at each end with a
// fluid lane between them keeps the supporters the same size at every width.
//
// The lane is straight, so the car is moved with a CSS keyframe rather than
// useRoadRunner - there is no curve to follow and no tangent to compute.
//
// They cheer whether or not anyone holds first place. That is the product
// decision, taken deliberately: an early leaderboard is empty for weeks, and
// a still grandstand made the whole tab look broken rather than new. The
// figures above stay honest - open places still read "Open" and score "-";
// it is only the scenery that is in a good mood.
// ------------------------------------------------------------------ //
const FANS_LEFT = [
  { x: 21, tone: '#F5C518', delay: 0, lean: -5 },
  { x: 55, tone: '#38BDF8', delay: 230, lean: 6 }
];
const FANS_RIGHT = [
  { x: 21, tone: '#34D399', delay: 120, lean: 5 },
  { x: 55, tone: '#FB7185', delay: 350, lean: -6 }
];

export function ArenaCrowd() {
  return (
    <div className="m5-crowd" aria-hidden="true">
      <FanGroup fans={FANS_LEFT} />

      <div className="m5-crowd-lane">
        <span className="m5-crowd-road" />
        <svg className="m5-crowd-car" viewBox="0 0 20 14" focusable="false">
          <g transform="translate(10 9)">
            <CarShape scale={1.05} />
          </g>
        </svg>
      </div>

      <FanGroup fans={FANS_RIGHT} />
    </div>
  );
}

function FanGroup({ fans }) {
  return (
    <svg className="m5-crowd-side" viewBox="0 0 76 60" focusable="false">
      {fans.map((fan) => <Fan key={fan.x} {...fan} />)}
    </svg>
  );
}

function Fan({ x, tone, delay, lean }) {
  return (
    <g transform={`translate(${x} 50)`}>
      <g className="m5-fan" style={{ '--m5-delay': `${delay}ms`, '--m5-lean': `${lean}deg` }}>
        {/* Each arm pivots at the shoulder - the BOTTOM of its rect - which is
            what transform-origin: 50% 100% on .m5-fan-arm buys. */}
        <g className="m5-fan-arm left">
          <rect x="-12.4" y="-29" width="3.8" height="12.8" rx="1.9" fill={tone} />
        </g>
        <g className="m5-fan-arm right">
          <rect x="8.6" y="-29" width="3.8" height="12.8" rx="1.9" fill={tone} />
        </g>
        <rect x="-7.4" y="-20.4" width="14.8" height="20.4" rx="6.8" fill={tone} />
        <circle cx="0" cy="-26.4" r="6.7" fill="#FDE68A" />
      </g>
    </g>
  );
}

// ------------------------------------------------------------------ //
// A month that DID happen, told as a drive.
//
// The first version put plain dots on the road, which read as a diagram
// nobody could interpret. These are map pins - the shape everybody already
// knows means "a place" - one per completed trip, and the road ends at a
// chequered flag because the month is over. The houses and trees are there
// so it is a scene rather than a chart with the axes rubbed out.
//
// Six pins is the cap. Past that the strip is a row of pins rather than a
// journey, and the list underneath carries the exact count anyway.
// ------------------------------------------------------------------ //
const MONTH_ROAD = 'M-14 44 C 66 44 84 30 168 30 C 248 30 282 38 330 38';
const STOP_AT = [0.2, 0.33, 0.46, 0.59, 0.72, 0.85];

const PIN_TONES = ['var(--teal)', 'var(--teal-dark)'];

export function MonthRoad({ trips = 0 }) {
  const roadRef = useRef(null);
  const carRef = useRef(null);
  const [stops, setStops] = useState([]);
  const shown = Math.min(Math.max(0, trips), STOP_AT.length);

  useRoadRunner(roadRef, carRef, { lapMs: 10000, resting: 0.28 });

  // The pins sit ON the road, so their coordinates are read off the path
  // rather than kept in a table that would drift the moment the curve is
  // retuned. roadRef is the same path the car follows.
  useEffect(() => {
    const road = roadRef.current;
    if (!road) return;
    const length = road.getTotalLength();
    setStops(STOP_AT.slice(0, shown).map((t) => {
      const point = road.getPointAtLength(length * t);
      return { x: point.x, y: point.y };
    }));
  }, [shown]);

  // The viewBox y origin is negative to buy headroom. The tallest roof apex
  // sits at y=7 and was pressing against the top edge; shifting the window
  // rather than every coordinate keeps the layout maths honest.
  return (
    <div className="m5-scene m5-scene-month">
      <svg
        className="m5-scene-art"
        viewBox="0 -16 360 92"
        role="img"
        aria-label={`A month's drive with ${shown} stop${shown === 1 ? '' : 's'} along the way.`}
      >
        {/* Scenery first, so the road and everything on it sits in front. */}
        <g opacity="0.7">
          <House x={40} h={24} tone="var(--teal)" />
          <House x={286} h={28} tone="var(--teal-dark)" />
        </g>
        <g transform="translate(196 44)"><SmallTree scale={1.5} /></g>

        <path ref={roadRef} d={MONTH_ROAD} fill="none" stroke="var(--teal-tint)" strokeWidth="8" strokeLinecap="round" />
        <path d={MONTH_ROAD} fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeDasharray="6 9" strokeLinecap="round" opacity="0.85" />

        {/* The month is over, so the road ends at a flag. */}
        <g className="m5-flag" transform="translate(332 38)">
          <rect x="-0.9" y="-26" width="1.8" height="26" rx="0.9" fill="#475569" />
          <g className="m5-flag-cloth">
            <rect x="0.9" y="-26" width="16" height="11" fill="#FFFFFF" stroke="#475569" strokeWidth="0.7" />
            <rect x="0.9" y="-26" width="5.3" height="5.5" fill="#334155" />
            <rect x="11.5" y="-26" width="5.4" height="5.5" fill="#334155" />
            <rect x="6.2" y="-20.5" width="5.3" height="5.5" fill="#334155" />
          </g>
        </g>

        {stops.map((point, index) => (
          /* Position on the OUTER g as an attribute, animation on the inner
             one as CSS. On one element the CSS transform wins outright and
             the pin animates from the origin instead of from the road. */
          <g key={`${point.x}-${index}`} transform={`translate(${point.x} ${point.y})`}>
            <g className="m5-pin" style={{ '--m5-delay': `${260 + index * 140}ms` }}>
              <MapPin tone={PIN_TONES[index % PIN_TONES.length]} />
            </g>
          </g>
        ))}

        <g ref={carRef}>
          <CarShape scale={1.1} />
          <LeafPuffs />
        </g>
      </svg>
    </div>
  );
}

// A teardrop pin, point-down, so it reads as "a place you went" at 14px.
function MapPin({ tone }) {
  return (
    <g>
      <path
        d="M0 0 C -4.4 -6 -6.2 -8.4 -6.2 -11.2 A 6.2 6.2 0 0 1 6.2 -11.2 C 6.2 -8.4 4.4 -6 0 0 Z"
        fill={tone}
      />
      <circle cx="0" cy="-11.2" r="2.4" fill="#FFFFFF" />
    </g>
  );
}

// Bigger than it looks like it needs to be. At 18px wide with a shallow roof
// this rendered as a dark green lozenge; a house needs an overhanging roof and
// a door reaching the ground before anyone reads it as a house.
function House({ x, h, tone, y = 46 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-11} y={-h} width="22" height={h} rx="2" fill={tone} />
      <path d={`M-14.5 ${-h} L0 ${-h - 11} L14.5 ${-h} Z`} fill="var(--teal-dark)" />
      <rect x="-3.6" y={-h + 7} width="7.2" height={h - 7} rx="1.6" fill="#FFFFFF" opacity="0.9" />
    </g>
  );
}

// ------------------------------------------------------------------ //
// The foot of the History list. The list runs newest to oldest, so the very
// bottom is where the user actually began - a start line, not an end.
// ------------------------------------------------------------------ //
export function JourneyStart({ label }) {
  const roadRef = useRef(null);
  const carRef = useRef(null);

  useRoadRunner(roadRef, carRef, { lapMs: 12000, resting: 0.22 });

  return (
    <div className="m5-journey-start">
      <svg className="m5-scene-art" viewBox="0 -10 360 106" role="img" aria-label="The start line of your trip history.">
        {/* Scenery first, so the road and the car sit in front of it. */}
        <g opacity="0.7">
          <House x={40} h={26} tone="var(--teal)" y={64} />
          <House x={302} h={30} tone="var(--teal-dark)" y={64} />
        </g>
        <g transform="translate(224 64)"><SmallTree scale={1.6} /></g>

        <path ref={roadRef} d="M-14 72 C 70 72 96 60 178 60 C 258 60 300 68 374 68" fill="none" stroke="var(--teal-tint)" strokeWidth="9" strokeLinecap="round" />
        <path d="M-14 72 C 70 72 96 60 178 60 C 258 60 300 68 374 68" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeDasharray="6 10" strokeLinecap="round" />

        {/* The gantry the whole history starts under. */}
        <g transform="translate(88 72)">
          <rect x="-1.2" y="-44" width="2.4" height="44" rx="1.2" fill="#475569" opacity="0.55" />
          <rect x="1.2" y="-44" width="58" height="16" rx="3" fill="var(--teal)" />
          <circle className="m5-blink" cx="12" cy="-36" r="2.8" fill="#FDE68A" />
          <circle className="m5-blink" style={{ animationDelay: '750ms' }} cx="48" cy="-36" r="2.8" fill="#FDE68A" />
          <rect x="18" y="-39.5" width="24" height="5" rx="2.5" fill="#FFFFFF" opacity="0.85" />
        </g>

        <g ref={carRef}>
          <CarShape scale={1.25} />
          <LeafPuffs x={-12} />
        </g>
      </svg>
      {label && <p>Your first trip was in {label}.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ //
// A filter that currently holds nothing.
//
// The first attempt drew an empty parking bay - a dashed rectangle - beside
// two houses and a tree. Nobody read it as "no trips at this stage"; it read
// as a stray dotted box. Six small things in a 300px strip is a diagram, not
// a picture.
//
// This is four big ones: a signpost naming the stage, an empty road, one tree,
// and the car driving straight past without stopping. The empty road IS the
// message, so nothing has to stand in for it.
// ------------------------------------------------------------------ //
export function StageEmpty({ label = null }) {
  const roadRef = useRef(null);
  const carRef = useRef(null);

  useRoadRunner(roadRef, carRef, { lapMs: 6000, resting: 0.3 });

  return (
    <svg
      className="m5-scene-art m5-stage-empty"
      viewBox="0 -10 300 96"
      role="img"
      aria-label={label ? `No trips at the ${label} stage yet.` : 'Nothing here yet.'}
    >
      <g transform="translate(252 66)"><SmallTree scale={1.5} /></g>

      {/* The signpost, planted beside the road and big enough to read. */}
      <g transform="translate(112 66)">
        <rect x="-2" y="-34" width="4" height="34" rx="2" fill="#94A3B8" />
        <rect x="-52" y="-58" width="104" height="26" rx="6" fill="#FFFFFF" stroke="var(--teal)" strokeWidth="2" />
        <text x="0" y="-40.5" textAnchor="middle" className="m5-stage-label">{label}</text>
      </g>

      <path ref={roadRef} d="M-14 76 H314" fill="none" stroke="var(--teal-tint)" strokeWidth="12" strokeLinecap="round" />
      <path d="M-14 76 H314" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="9 12" strokeLinecap="round" />

      <g ref={carRef}>
        <CarShape scale={1.6} />
        <LeafPuffs x={-14} />
      </g>
    </svg>
  );
}
