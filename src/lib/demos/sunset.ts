import type { GraphData } from '../graphFile';
import { entryMaker, graph } from './common';

/**
 * "Sunset": a cinematic Graph-mode scene built from the animation features —
 * one gradient sky, a radial sun glow in screen blend, additive god-rays (one
 * row, per-copy alpha via k), drifting clouds (per-copy colours, low samples),
 * parallax mountain / hill layers, a smooth spline + bezier + arc silhouette,
 * a glowing scarf, a camera shake, letterboxed to 2.39 : 1 at a fixed 24 fps.
 * One 24 s clock T; every motion is periodic in it, so the loop is seamless.
 */
export function sunsetDemo(): GraphData {
  const E = entryMaker('sun');
  const fill = { fill: true, fillOpacity: 1, lineWidth: 0 } as const;
  const entries = [
    // 24 s per loop (speed 1 ≈ one sweep in 4 s).
    E('T = 0', '#c74440', { varMin: 0, varMax: 24, animMode: 'loop', animSpeed: 1 / 6, autoplay: true, expanded: true }),
    // Sky: one gradient instead of stacked bands.
    E('((-18, -8), (18, -8), (18, 8), (-18, 8))', '#0b1d3a', {
      ...fill,
      fillColor: 'linear(0, 7, 0, -3, #0b1d3a, #5a3a7a, #f28c38)',
    }),
    // Sun glow: one radial gradient, screen-blended.
    E('(3.2cos(t) + 5, 3.2sin(t) + 0.5)', '#ffd7a0', {
      ...fill,
      blend: 'screen',
      fillColor: 'radial(5, 0.5, 3.2, rgba(255, 245, 215, 1), rgba(255, 200, 120, 0.55), rgba(255, 140, 60, 0))',
    }),
    // God-rays: thin additive wedges whose brightness breathes per copy.
    E(
      '((5, 0.5), (5 + 16cos(a - 0.035), 0.5 + 16sin(a - 0.035)), (5 + 16cos(a + 0.035), 0.5 + 16sin(a + 0.035))) where a = 0.35k + 0.04sin(pi*T/6 + k) for k = 0..17',
      '#ffd2a0',
      { ...fill, blend: 'add', fillColor: 'rgba(255, 210, 150, 0.04 + 0.03sin(pi*T/6 + k))' },
    ),
    // Sun disc with a glow.
    E('(1.1cos(t) + 5, 1.1sin(t) + 0.5)', '#fff3d6', { ...fill, glow: 24, fillColor: '#fff3d6' }),
    // Far mountains: a slow parallax layer and a smooth ridge.
    E('far = layer(-0.6sin(pi*T/12), 0)', '#000000'),
    E(
      '((-19, -8), spline((-19, -1.2), (-13, 1.1), (-8, -0.4), (-2, 1.7), (3, -0.1), (8, 1.3), (13, -0.5), (19, 0.6)), (19, -8))',
      '#3b2f5c',
      { ...fill, layer: 'far', fillColor: '#3b2f5c' },
    ),
    // Clouds: one row, per-copy tint, few samples (they're soft blobs).
    E(
      '(s*cos(t) + mod(4.5k - 5T/3, 40) - 20, 0.42s*sin(t) + 3.6 + 0.45*mod(k, 3)) where s = 1.3 + 0.3sin(k) for k = 0..8',
      '#ffd9cc',
      { ...fill, fillOpacity: 0.55, fillColor: 'rgb(255, 225 - 7k, 205)', samples: 48 },
    ),
    // Near hills and the hero on them: a faster parallax layer.
    E('near = layer(-1.5sin(pi*T/12), 0)', '#000000'),
    E(
      '((-19, -8), spline((-19, -3.4), (-11, -2.3), (-5, -3.7), (2, -2.45), (8, -3.4), (14, -2.2), (19, -3)), (19, -8))',
      '#120d1f',
      { ...fill, layer: 'near', fillColor: '#120d1f' },
    ),
    // Silhouette: straight legs, a spline cloak, a bezier hood and an arc shoulder.
    E(
      '((1.55, -2.5), (1.7, -1.3), spline((1.75, -0.95), (1.85, -0.75)), bezier((1.9, -0.25), (2.3, -0.25), (2.3, -0.75)), arc((2.05, -0.95), -1.2), (2.45, -2.5))',
      '#000000',
      { ...fill, layer: 'near', fillColor: '#07050c' },
    ),
    // Scarf streaming in the wind, glowing.
    E('(2.15 + t, -0.85 + 0.14t*sin(6t - 2pi*T))', '#ff3b30', {
      thetaMin: 0,
      thetaMax: 1.3,
      lineWidth: 4,
      glow: 10,
      layer: 'near',
    }),
    // Camera: a short shake every 8 s.
    E('camera = layer(0.05sin(20pi*T)*pulse(mod(T, 8), 0, 0.4), 0)', '#000000'),
  ];
  const g = graph(entries, { tMin: -16, tMax: 16, yMin: -6.7, yMax: 6.7 });
  return { ...g, features: { ...g.features, aspect: 2.39, fps: 24 } };
}
