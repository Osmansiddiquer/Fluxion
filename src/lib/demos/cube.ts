import type { GraphData } from '../graphFile';
import { entryMaker, graph } from './common';

/**
 * Goal 2: a rotating wireframe cube. Vertices are indexed 0…7 by their bits,
 * projected with the built-in 3D helpers (projx/projy: yaw, pitch, camera
 * distance); edges and faces are lookup tables drawn with `for` repeats.
 */
export function cubeDemo(): GraphData {
  const E = entryMaker('cube');
  const entries = [
    E('a = 0', '#c74440', {
      varMin: 0,
      varMax: 2 * Math.PI,
      animMode: 'loop',
      animSpeed: 0.35,
      autoplay: true,
      expanded: true,
    }),
    E('b = 0.45', '#2d70b3', { varMin: -1.5, varMax: 1.5 }),
    E('d = 6', '#388c46', { varMin: 2.5, varMax: 20 }),
    // Vertex i = (±1, ±1, ±1) from its bits.
    E('vx(i) = 2*mod(i, 2) - 1', '#000000'),
    E('vy(i) = 2*mod(floor(i/2), 2) - 1', '#000000'),
    E('vz(i) = 2*mod(floor(i/4), 2) - 1', '#000000'),
    E('X(i) = 1.6 projx(vx(i), vy(i), vz(i), a, b, d)', '#000000'),
    E('Y(i) = 1.6 projy(vx(i), vy(i), vz(i), a, b, d)', '#000000'),
    // Edge k joins vertex A(k) to B(k); face k has corners Q(k, 0…3).
    E('A(k) = [0, 1, 3, 2, 4, 5, 7, 6, 0, 1, 2, 3][k + 1]', '#000000'),
    E('B(k) = [1, 3, 2, 0, 5, 7, 6, 4, 4, 5, 6, 7][k + 1]', '#000000'),
    E(
      'Q(k, j) = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]][k + 1, j + 1]',
      '#000000',
    ),
    // Translucent faces (hue follows the rotation), then edges and vertices.
    E(
      '((X(Q(k, 0)), Y(Q(k, 0))), (X(Q(k, 1)), Y(Q(k, 1))), (X(Q(k, 2)), Y(Q(k, 2))), (X(Q(k, 3)), Y(Q(k, 3)))) for k = 0..5',
      '#2d70b3',
      { fill: true, fillOpacity: 0.1, lineWidth: 0, fillColor: 'hsv(57.3 a, 0.55, 0.95)' },
    ),
    E('((X(A(k)), Y(A(k))), (X(B(k)), Y(B(k)))) for k = 0..11', '#2d70b3', { lineWidth: 3 }),
    E('(X(i), Y(i)) for i = 0..7', '#2d70b3', { pointSize: 4.5 }),
  ];
  return graph(entries, { tMin: -5, tMax: 5, yMin: -3.2, yMax: 3.2 });
}
