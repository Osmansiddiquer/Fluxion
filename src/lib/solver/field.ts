import type { Viewport } from '../../store/types';

/**
 * Direction fields on a grid over the viewport.
 *
 * A *slope field* (first-order y' = f(t, y)) has a short tangent segment of
 * slope f at each grid point; a *vector field* (a 2-D autonomous system in the
 * phase plane) has an arrow along (f, g). Both store unit directions: the plot
 * keeps x and y at the same scale, so a unit vector in data space is a unit
 * vector on screen. The grid snaps to multiples of a "nice" spacing, so panning
 * slides the field with the plot instead of making it swim, and the spacing
 * follows the zoom level.
 */
export interface FieldSample {
  kind: 'slope' | 'vector';
  /** Grid spacing in data units (the drawn segment length scales with it). */
  spacing: number;
  /** Flattened [x, y, ux, uy, mag] per grid point (unit direction + magnitude). */
  data: Float64Array;
  /** Number of grid points stored. */
  count: number;
}

/** Fields per row across the viewport (roughly; the spacing is snapped). */
export const FIELD_TARGET_COLS = 22;
/** Hard cap on grid points per field. */
const MAX_POINTS = 2400;

/** A "nice" spacing (1, 2, 2.5 or 5 × 10^k) near `raw`. */
export function niceSpacing(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const nice = m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10;
  return nice * p;
}

/** Grid spacing for a viewport (target ≈ FIELD_TARGET_COLS columns). */
export function fieldSpacing(vp: Viewport, cols = FIELD_TARGET_COLS): number {
  return niceSpacing((vp.tMax - vp.tMin) / Math.max(4, cols));
}

/** Grid nodes covering the viewport, aligned to multiples of `h` (half a cell in from the edges). */
function gridAxis(lo: number, hi: number, h: number): number[] {
  const out: number[] = [];
  const start = Math.floor(lo / h) * h + h / 2;
  for (let v = start, i = 0; v < hi && i < 400; v += h, i++) if (v > lo) out.push(v);
  return out;
}

/**
 * Sample a field. `dir(x, y)` returns the raw direction [dx, dy] at a point (or
 * null where undefined); slope fields pass [1, f(t, y)].
 */
export function sampleField(
  kind: FieldSample['kind'],
  dir: (x: number, y: number) => [number, number] | null,
  vp: Viewport,
  cols = FIELD_TARGET_COLS,
): FieldSample {
  let h = fieldSpacing(vp, cols);
  let xs = gridAxis(vp.tMin, vp.tMax, h);
  let ys = gridAxis(vp.yMin, vp.yMax, h);
  // A very tall view would need too many points: coarsen.
  while (xs.length * ys.length > MAX_POINTS) {
    h = niceSpacing(h * 1.6);
    xs = gridAxis(vp.tMin, vp.tMax, h);
    ys = gridAxis(vp.yMin, vp.yMax, h);
  }
  const data = new Float64Array(xs.length * ys.length * 5);
  let n = 0;
  for (const y of ys) {
    for (const x of xs) {
      let d: [number, number] | null;
      try {
        d = dir(x, y);
      } catch {
        d = null;
      }
      if (!d) continue;
      const [dx, dy] = d;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      const mag = Math.hypot(dx, dy);
      const o = n * 5;
      data[o] = x;
      data[o + 1] = y;
      if (mag > 0) {
        data[o + 2] = dx / mag;
        data[o + 3] = dy / mag;
      }
      // Zero vectors (equilibria) keep a zero direction and draw as a dot.
      data[o + 4] = mag;
      n++;
    }
  }
  return { kind, spacing: h, data: n * 5 === data.length ? data : data.slice(0, n * 5), count: n };
}

/** Slope field of y' = f(t, y). */
export function sampleSlopeField(f: (t: number, y: number) => number, vp: Viewport, cols?: number): FieldSample {
  return sampleField(
    'slope',
    (t, y) => {
      const s = f(t, y);
      return Number.isFinite(s) ? [1, s] : null;
    },
    vp,
    cols,
  );
}

/** Vector field (f, g) of a planar system. */
export function sampleVectorField(
  fg: (x: number, y: number) => [number, number],
  vp: Viewport,
  cols?: number,
): FieldSample {
  return sampleField('vector', fg, vp, cols);
}
