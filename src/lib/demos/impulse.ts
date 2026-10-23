import type { GraphData } from '../graphFile';
import { entryMaker, PANELS_OFF } from './common';

/**
 * "Spring hit by a hammer" (issue #3, the Laplace-unit classic): a damped
 * spring m·y″ + c·y′ + k·y = J·δ(t − T) at rest until the impulse at t = T,
 * which kicks the velocity by J/m; then it rings down. Initial conditions are
 * typed inline. Every parameter is a slider (T plays the hammer along t).
 */
export function impulseDemo(): GraphData {
  const E = entryMaker('imp');
  const entries = [
    E("m y'' + c y' + k y = J delta(t - T), y(0) = 0, y'(0) = 0", '#2d70b3', { expanded: true }),
    E('x = T', '#98a2af', { lineStyle: 'dashed', lineWidth: 1.5 }),
    E('m = 1', '#000000', { varMin: 0.2, varMax: 4, varStep: 0.1, expanded: true }),
    E('c = 0.3', '#000000', { varMin: 0, varMax: 3, varStep: 0.05, expanded: true }),
    E('k = 4', '#000000', { varMin: 0.5, varMax: 10, varStep: 0.1, expanded: true }),
    E('J = 3', '#000000', { varMin: -6, varMax: 6, varStep: 0.1, expanded: true }),
    E('T = 1.5', '#000000', { varMin: 0, varMax: 10, varStep: 0.1, animMode: 'bounce', expanded: true }),
  ];
  return {
    v: 1,
    entries,
    viewport: { tMin: -1, tMax: 11, yMin: -4.5, yMax: 4.5 },
    features: {
      extrema: true,
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
