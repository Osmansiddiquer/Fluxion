import type { GraphData } from '../graphFile';
import { circle, entryMaker, graph } from './common';

/**
 * A blooming mandala: three rings of petals (one parametric petal repeated with
 * `for`, turned with rotx/roty) counter-rotate while one 12 s clock T opens and
 * closes the bloom (skeys) and walks every hue round the colour wheel (hsv). At
 * T = 12 the scale is back at its start, the rings have turned whole symmetry
 * steps and the hue a full 360°, so the loop has no seam.
 */

/** Petal in local coordinates, u ∈ [0, 2π]: base at the origin, tip at (L, 0). */
export const PETAL_X = 'Px(u, L, W) = L*(1 - cos(u))/2';
export const PETAL_Y = 'Py(u, L, W) = W*sin(u)*(1 - cos(u))/2';

/** Petal turned to angle q. */
const petal = (L: string, W: string, q: string) =>
  `(rotx(Px(t, ${L}, ${W}), Py(t, ${L}, ${W}), ${q}), roty(Px(t, ${L}, ${W}), Py(t, ${L}, ${W}), ${q}))`;

export function mandalaDemo(): GraphData {
  const E = entryMaker('mdl');
  const entries = [
    // One clock drives everything: 12 s per loop (speed 1 ≈ one sweep in 4 s).
    E('T = 0', '#c74440', {
      varMin: 0,
      varMax: 12,
      animMode: 'loop',
      animSpeed: 1 / 3,
      autoplay: true,
      expanded: true,
    }),
    // Bloom: closed bud → open → hold → close, eased.
    E('s = skeys(T, 0, 0.35, 4, 1, 8, 1, 12, 0.35)', '#000000'),
    // Rotation: a full turn per loop (every ring's symmetry divides it).
    E('w = pi T/6', '#000000'),
    E(PETAL_X, '#000000'),
    E(PETAL_Y, '#000000'),
    // Outer halo: a dotted ring that breathes with the bloom.
    E(circle('4.4 s'), '#888888', { lineWidth: 1.5, lineStyle: 'dotted', colorExpr: 'hsv(30 T + 200, 0.5, 0.75)' }),
    // Outer ring: 12 broad petals turning forwards.
    E(`${petal('3.9 s', '1.5 s', 'w + pi k/6')} for k = 0..11`, '#c74440', {
      fill: true,
      fillOpacity: 0.32,
      lineWidth: 1.5,
      colorExpr: 'hsv(30 T, 0.75, 0.8)',
      fillColor: 'hsv(30 T, 0.6, 1)',
    }),
    // Middle ring: 12 petals offset half a step, turning backwards.
    E(`${petal('2.7 s', '1.1 s', '-w + pi/12 + pi k/6')} for k = 0..11`, '#2d70b3', {
      fill: true,
      fillOpacity: 0.45,
      lineWidth: 1.5,
      colorExpr: 'hsv(30 T + 120, 0.75, 0.75)',
      fillColor: 'hsv(30 T + 120, 0.55, 1)',
    }),
    // Inner star: 6 slim petals spinning twice as fast.
    E(`${petal('1.7 s', '0.7 s', '2 w + pi k/3')} for k = 0..5`, '#388c46', {
      fill: true,
      fillOpacity: 0.7,
      lineWidth: 1.2,
      colorExpr: 'hsv(30 T + 240, 0.8, 0.7)',
      fillColor: 'hsv(30 T + 240, 0.6, 1)',
    }),
    // Seeds orbiting the halo, a shade off the outer petals.
    E('(4.4 s cos(-w/2 + pi k/12), 4.4 s sin(-w/2 + pi k/12)) for k = 0..23', '#c74440', {
      pointSize: 3,
      colorExpr: 'hsv(30 T + 40, 0.8, 0.9)',
    }),
    // Golden heart with a pulsing rim.
    E(circle('0.55 + 0.08 sin(2 w)'), '#e8a33d', {
      fill: true,
      fillOpacity: 1,
      fillColor: 'hsv(42, 0.75, 1)',
      lineWidth: 2,
      colorExpr: 'hsv(30 T + 300, 0.7, 0.8)',
    }),
    E(circle('0.22'), '#7a4a00', { fill: true, fillOpacity: 0.85, lineWidth: 0, fillColor: 'hsv(30, 0.9, 0.55)' }),
  ];
  return graph(entries, { tMin: -6, tMax: 6, yMin: -5, yMax: 5 });
}
