import type { IPoly } from './codec';

/**
 * Binary image → closed contour polygons (marching squares over pixel centres,
 * padded with background so every contour closes), then Douglas–Peucker
 * simplification. Output coordinates are integers in half-pixel units: an image
 * of W×H pixels maps to [0, 2W] × [0, 2H] (y down). Filling the polygons with
 * the even-odd rule reproduces the image, holes included.
 */
export interface BinaryImage {
  width: number;
  height: number;
  /** Row-major, 1 = ink, 0 = background. */
  data: Uint8Array;
}

/** Threshold a grayscale image (0–255) into ink (dark by default). */
export function threshold(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  level = 128,
  inkIsDark = true,
): BinaryImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const dark = gray[i] < level;
    data[i] = dark === inkIsDark ? 1 : 0;
  }
  return { width, height, data };
}

// Segment table: which cell edges each 4-corner case connects. Corners are
// TL=8, TR=4, BR=2, BL=1; edges T, R, B, L. Saddles (5, 10) are kept separate.
type Edge = 'T' | 'R' | 'B' | 'L';
const CASES: Edge[][][] = [
  [],
  [['L', 'B']],
  [['B', 'R']],
  [['L', 'R']],
  [['T', 'R']],
  [['T', 'R'], ['L', 'B']],
  [['T', 'B']],
  [['T', 'L']],
  [['T', 'L']],
  [['T', 'B']],
  [['T', 'L'], ['B', 'R']],
  [['T', 'R']],
  [['L', 'R']],
  [['B', 'R']],
  [['L', 'B']],
  [],
];

/** Raw (unsimplified) closed contours of a binary image. */
export function traceContours(img: BinaryImage): IPoly[] {
  const { width: W, height: H, data } = img;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : data[j * W + i]);
  const key = (x: number, y: number) => y * (2 * W + 3) + x;

  // Undirected segments between edge midpoints; each midpoint has degree 2.
  const segA: number[] = [];
  const segB: number[] = [];
  const coord = new Map<number, [number, number]>();
  const adj = new Map<number, number[]>();
  const addPoint = (x: number, y: number) => {
    const k = key(x, y);
    if (!coord.has(k)) coord.set(k, [x, y]);
    return k;
  };
  const link = (a: number, b: number) => {
    const id = segA.length;
    segA.push(a);
    segB.push(b);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(id);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(id);
  };

  for (let j = -1; j < H; j++) {
    for (let i = -1; i < W; i++) {
      const c = (at(i, j) << 3) | (at(i + 1, j) << 2) | (at(i + 1, j + 1) << 1) | at(i, j + 1);
      const segs = CASES[c];
      if (!segs.length) continue;
      const mid = (e: Edge): number => {
        switch (e) {
          case 'T':
            return addPoint(2 * i + 2, 2 * j + 1);
          case 'B':
            return addPoint(2 * i + 2, 2 * j + 3);
          case 'L':
            return addPoint(2 * i + 1, 2 * j + 2);
          default:
            return addPoint(2 * i + 3, 2 * j + 2);
        }
      };
      for (const [e1, e2] of segs) link(mid(e1), mid(e2));
    }
  }

  // Walk loops.
  const used = new Uint8Array(segA.length);
  const loops: IPoly[] = [];
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segA[s];
    let cur = segB[s];
    const loop: IPoly = [coord.get(start)!];
    let guard = 0;
    while (cur !== start && guard++ < segA.length + 1) {
      loop.push(coord.get(cur)!);
      const next = (adj.get(cur) ?? []).find((id) => !used[id]);
      if (next === undefined) break;
      used[next] = 1;
      cur = segA[next] === cur ? segB[next] : segA[next];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Douglas–Peucker on an open polyline (keeps both endpoints). */
export function simplifyOpen(pts: IPoly, tol: number): IPoly {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed loop: split at the point farthest from the first. */
export function simplifyClosed(loop: IPoly, tol: number): IPoly {
  if (loop.length <= 3) return loop.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(loop.slice(0, far + 1), tol);
  const b = simplifyOpen([...loop.slice(far), loop[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/** Contours of a binary image, simplified; tiny specks dropped. */
export function vectorize(img: BinaryImage, tol = 1, minArea = 2): IPoly[] {
  const out: IPoly[] = [];
  for (const loop of traceContours(img)) {
    const simp = simplifyClosed(loop, tol);
    if (simp.length < 3) continue;
    if (Math.abs(polygonArea(simp)) < minArea) continue;
    out.push(simp);
  }
  return out;
}

/** Signed shoelace area. */
export function polygonArea(poly: IPoly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Even-odd point-in-polygons test (for verification / rasterising back). */
export function insideEvenOdd(polys: IPoly[], x: number, y: number): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
