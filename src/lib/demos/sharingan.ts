import type { GraphData } from '../graphFile';
import { circle, entryMaker, graph } from './common';

/**
 * Tomoe ("magatama") outline in local coordinates, u ∈ [0, 3]: three circular
 * arcs — the right half of a circle of radius 2s, then the lower small circle
 * (radius s) round its right side up to the centre, then the upper small circle
 * round its left side back to the top. Head at the top, tail tip at (0, −2s).
 */
export const TOMOE_X =
  'Fx(u, s) = u < 1 ? 2s cos(pi/2 - pi u) : (u < 2 ? s cos(pi*(u - 1) - pi/2) : s cos(-pi/2 - pi*(u - 2)))';
export const TOMOE_Y =
  'Fy(u, s) = u < 1 ? 2s sin(pi/2 - pi u) : (u < 2 ? s sin(pi*(u - 1) - pi/2) - s : s sin(-pi/2 - pi*(u - 2)) + s)';

/** Goal 1: a Sharingan whose three tomoe orbit the pupil. */
export function sharinganDemo(): GraphData {
  const E = entryMaker('shr');
  const entries = [
    // Rotation angle: 0 → 2π/3 loops seamlessly (the pattern has 3-fold symmetry).
    E('a = 0', '#c74440', {
      varMin: 0,
      varMax: (2 * Math.PI) / 3,
      animMode: 'loop',
      animSpeed: 0.6,
      autoplay: true,
      expanded: true,
    }),
    E(TOMOE_X, '#000000'),
    E(TOMOE_Y, '#000000'),
    E('p(k) = a + 2pi k/3', '#000000'),
    // Iris, inner glow, tomoe ring, pupil.
    E(circle(2), '#2a0505', { fill: true, fillOpacity: 1, fillColor: '#b3121b', lineWidth: 3 }),
    E(circle(1.55), '#d8262d', { fill: true, fillOpacity: 0.55, lineWidth: 0 }),
    E(circle(1.25), '#4a0c0c', { lineWidth: 1.6, colorExpr: 'rgba(60, 8, 8, 0.85)' }),
    E(circle(0.42), '#0b0b0b', { fill: true, fillOpacity: 1, lineWidth: 0 }),
    // The three tomoe, placed on the ring and turned to follow it.
    E(
      '(1.25 cos(p(k)) + rotx(Fx(t, 0.22), Fy(t, 0.22), p(k)), 1.25 sin(p(k)) + roty(Fx(t, 0.22), Fy(t, 0.22), p(k))) for k = 0..2',
      '#0b0b0b',
      { thetaMin: 0, thetaMax: 3, fill: true, fillOpacity: 1, lineWidth: 0 },
    ),
    // Specular highlight.
    E('(0.24 cos(t) - 0.8, 0.15 sin(t) + 0.9)', '#ffffff', {
      fill: true,
      fillOpacity: 0.7,
      lineWidth: 0,
    }),
  ];
  return graph(entries, { tMin: -4.5, tMax: 4.5, yMin: -3, yMax: 3 });
}
