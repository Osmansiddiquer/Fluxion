import type { GraphData } from '../graphFile';
import { circle, entryMaker, graph } from './common';
import { TOMOE_X, TOMOE_Y } from './sharingan';

/**
 * Goal 3: an eye that turns into a Sharingan, spins, morphs into a Mangekyō
 * Sharingan and back — all driven by one clock T through keyframed derived
 * values (no script code): colour, tomoe size/opacity, rotation and a shape
 * morph that interpolates each tomoe outline into a curved blade.
 */
export function mangekyoDemo(): GraphData {
  const E = entryMaker('mgk');
  const ink = '#0d0909';
  const entries = [
    // The clock: 0 → 12 s, played in real time (a 12-unit sweep at 1/3 speed takes 12 s).
    E('T = 0', '#2d70b3', {
      varMin: 0,
      varMax: 12,
      varStep: 0.05,
      animMode: 'loop',
      animSpeed: 1 / 3,
      autoplay: true,
      expanded: true,
    }),
    // Keyframed tracks: c = red-ness, g = tomoe growth, m = mangekyō morph, a = spin.
    E('c = skeys(T, 1, 0, 2.5, 1, 10.6, 1, 11.8, 0)', '#6042a6'),
    E('g = skeys(T, 2, 0, 3.2, 1, 10.4, 1, 11.4, 0)', '#6042a6'),
    E('m = skeys(T, 6.2, 0, 7.8, 1, 9.6, 1, 10.4, 0)', '#6042a6'),
    E('a = keys(T, 2, 0, 12, 15)', '#6042a6'),
    E('pr = lerp(lerp(0.55, 0.42, c), 0.66, m)', '#6042a6'),
    // Shapes: tomoe outline (see the Sharingan demo) and a Mangekyō blade
    // (leading spiral edge → rim arc → trailing spiral edge), both over u ∈ [0, 3].
    E(TOMOE_X, ink),
    E(TOMOE_Y, ink),
    E('p(k) = a + 2pi k/3', ink),
    E('Br(u) = u < 1 ? lerp(0.6, 1.95, u) : (u < 2 ? 1.95 : lerp(1.95, 0.6, u - 2))', ink),
    E('Bq(u) = u < 1 ? 1.1 u^2 : (u < 2 ? 1.1 + 0.5*(u - 1) : 0.55 + 1.05*(3 - u)^2)', ink),
    E('Tx(u, k) = 1.25 cos(p(k)) + rotx(Fx(u, 0.22 g), Fy(u, 0.22 g), p(k))', ink),
    E('Ty(u, k) = 1.25 sin(p(k)) + roty(Fx(u, 0.22 g), Fy(u, 0.22 g), p(k))', ink),
    E('Bx(u, k) = Br(u)*cos(p(k) + Bq(u))', ink),
    E('By(u, k) = Br(u)*sin(p(k) + Bq(u))', ink),
    // The eye.
    E('(5 cos(t), 2.6 sin(t) abs(sin(t)))', '#6e4a34', {
      fill: true,
      fillOpacity: 1,
      fillColor: '#f3ede4',
      lineWidth: 3.5,
    }),
    E('(5.3 cos(t), 3.15 sin(t) abs(sin(t)))', '#8a6a55', {
      thetaMin: 0.35,
      thetaMax: Math.PI - 0.35,
      lineWidth: 2,
      colorExpr: 'rgba(138, 106, 85, 0.75)',
    }),
    // Iris: brown → red, with a soft inner glow.
    E(circle(2), '#1d0d08', {
      fill: true,
      fillOpacity: 1,
      fillColor: 'rgb(lerp(92, 181, c), lerp(58, 18, c), lerp(36, 27, c))',
      lineWidth: 2.5,
    }),
    E(circle(1.55), '#8c5c3c', {
      fill: true,
      fillOpacity: 0.55,
      lineWidth: 0,
      colorExpr: 'rgb(lerp(140, 224, c), lerp(92, 44, c), lerp(60, 44, c))',
    }),
    E(circle(1.25), '#3c0808', { lineWidth: 1.6, colorExpr: 'rgba(60, 8, 8, 0.85 g)' }),
    E(circle('pr'), ink, { fill: true, fillOpacity: 1, lineWidth: 0 }),
    // Three tomoe that morph into the Mangekyō blades.
    E('(lerp(Tx(t, k), Bx(t, k), m), lerp(Ty(t, k), By(t, k), m)) for k = 0..2', ink, {
      thetaMin: 0,
      thetaMax: 3,
      fill: true,
      fillOpacity: 1,
      lineWidth: 0,
      colorExpr: 'rgba(13, 9, 9, clamp(1.5 g))',
    }),
    E('(0.26 cos(t) - 0.8, 0.16 sin(t) + 0.92)', '#ffffff', {
      fill: true,
      fillOpacity: 0.72,
      lineWidth: 0,
    }),
  ];
  return graph(entries, { tMin: -6.5, tMax: 6.5, yMin: -4, yMax: 4 });
}
