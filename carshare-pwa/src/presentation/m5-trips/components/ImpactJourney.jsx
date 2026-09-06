// ===== PRESENTATION LAYER (ImpactJourney) =====
// Module 5 - the illustration for the trees line at the foot of the Impact tab.
//
// THE SCENE IS THE DATA. The trees standing along the road are the ones the
// user has actually earned - summary.treesEquivalent, the same figure the
// sentence underneath quotes - and the dotted ones are what is still to come.
// Drawing six regardless would make it wallpaper.
//
// It lives under the figures rather than above them: a picture wants
// explaining, and the sentence it sits with does exactly that.
//
// The car drawing and the path-following live in tripScenes.jsx, shared with
// the other two scenes in this module.
import React, { useRef } from 'react';
import { CarShape, LeafPuffs, useRoadRunner } from './tripScenes.jsx';

const TREE_SLOTS = [32, 78, 124, 208, 262, 322];
const ROAD = 'M-14 48 C 76 48 92 26 176 26 C 254 26 288 39 374 39';

export default function ImpactJourney({ trees = 0 }) {
  const roadRef = useRef(null);
  const carRef = useRef(null);
  const planted = Math.min(Math.max(0, trees), TREE_SLOTS.length);

  useRoadRunner(roadRef, carRef, { lapMs: 13000, resting: 0.32 });

  return (
    <div className="m5-journey">
      <svg
        className="m5-journey-art"
        viewBox="0 2 360 62"
        role="img"
        aria-label={
          planted === 0
            ? 'An empty roadside waiting for its first tree.'
            : `A road with ${planted} ${planted === 1 ? 'tree' : 'trees'} growing beside it.`
        }
      >
        {/* The road overshoots both edges, so the loop restarts off-screen
            and there is no visible jump. */}
        <path ref={roadRef} d={ROAD} fill="none" stroke="#FFFFFF" strokeWidth="9" strokeLinecap="round" opacity="0.9" />

        {TREE_SLOTS.map((x, index) => (
          <Tree key={x} x={x} planted={index < planted} delay={200 + index * 110} />
        ))}

        <g ref={carRef}>
          <CarShape scale={1.3} />
          <LeafPuffs />
        </g>
      </svg>
    </div>
  );
}

// The outer <g> carries the position as an ATTRIBUTE and the inner one carries
// the animation as CSS. They cannot share an element: a CSS transform overrides
// the transform attribute outright, which would drop every tree at the origin.
function Tree({ x, planted, delay }) {
  return (
    <g transform={`translate(${x} 56)`}>
      <g className={'m5-tree' + (planted ? ' planted' : '')} style={{ '--m5-delay': `${delay}ms` }}>
        {planted ? (
          <>
            <rect x="-1.4" y="-7" width="2.8" height="7.6" rx="1.3" fill="#92400E" opacity="0.75" />
            <circle cx="0" cy="-13.2" r="6.1" fill="var(--teal)" />
            <circle cx="-4.2" cy="-9.1" r="4.6" fill="var(--teal-dark)" opacity="0.85" />
            <circle cx="4.2" cy="-9.1" r="4.6" fill="var(--teal-dark)" opacity="0.7" />
          </>
        ) : (
          <circle cx="0" cy="-10.2" r="5.8" fill="none" stroke="var(--teal-dark)" strokeWidth="1.3" strokeDasharray="2.6 3" />
        )}
      </g>
    </g>
  );
}
