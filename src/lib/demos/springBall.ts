import type { GraphData } from '../graphFile';
import { entryMaker, PANELS_OFF } from './common';

/**
 * "Ball on a spring": the solution of y″ = −k·y − c·y′ (typed conditions
 * y(0) = 3, y′(0) = 0) called as a function, y(T), to move a ball. The clock T
 * plays in real time; the ball hangs from a coil spring whose mount slides along
 * the ceiling, so it rides the drawn curve like a chart recorder's pen.
 * E = y′(T)²/2 + k·y(T)²/2 shows the energy draining away with the damping c.
 */
export function springBallDemo(): GraphData {
  const E = entryMaker('spr');
  const ball = '#c74440';
  const steel = '#6b7684';
  const entries = [
    E("y'' = -k*y - c*y', y(0) = 3, y'(0) = 0", '#2d70b3', { expanded: true }),
    E('k = 2', '#000000', { varMin: 0.2, varMax: 6, varStep: 0.1, expanded: true }),
    E('c = 0.15', '#000000', { varMin: 0, varMax: 1, varStep: 0.01, expanded: true }),
    E('T = 0', '#000000', {
      varMin: 0,
      varMax: 20,
      varStep: 0.01,
      animMode: 'loop',
      // A full sweep in ~4 s at speed 1: 0.2 plays the 20 s in real time.
      animSpeed: 0.2,
      autoplay: true,
      expanded: true,
    }),
    // A chart recorder: the spring's mount slides along the ceiling (y = 4.5)
    // with T, so the ball draws the solution as it bobs.
    E('((T - 0.8, 4.5), (T + 0.8, 4.5))', steel, { lineWidth: 4, dots: false }),
    E('(T + 0.3*sin(14*pi*t), 4.5 + (y(T) - 4.5)*t)', steel, { thetaMin: 0, thetaMax: 1, lineWidth: 2 }),
    E('(T, y(T))', ball, { pointSize: 12, pointDrag: 'off' }),
    E("E = y'(T)^2/2 + k*y(T)^2/2", '#000000'),
  ];
  return {
    v: 1,
    entries,
    viewport: { tMin: -1.5, tMax: 21, yMin: -6, yMax: 6 },
    features: {
      extrema: false,
      xIntercepts: false,
      yIntercept: false,
      endpoints: false,
      discontinuities: false,
      intersections: false,
    },
    projections: PANELS_OFF,
    sigFigs: 3,
  };
}
