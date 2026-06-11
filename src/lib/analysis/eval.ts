import type { Point, SampledCurve } from '../solver/curve';

/**
 * Evaluate a sampled curve at an arbitrary t by linear interpolation, treating
 * it as a single-valued function of t (true for ODE solutions y(t) and explicit
 * functions). Returns null if t lies outside every segment (a gap / out of range).
 */
export function evalCurveAt(curve: SampledCurve, t: number): number | null {
  for (const seg of curve.segments) {
    if (seg.length === 0) continue;
    if (t < seg[0][0] || t > seg[seg.length - 1][0]) continue;
    // Binary search for the bracketing pair (segment is ascending in t).
    let lo = 0;
    let hi = seg.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (seg[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const [t0, y0] = seg[lo];
    const [t1, y1] = seg[hi];
    if (t1 === t0) return y0;
    const f = (t - t0) / (t1 - t0);
    return y0 + f * (y1 - y0);
  }
  return null;
}

/** The total t-extent actually covered by a curve (across all segments). */
export function curveExtent(curve: SampledCurve): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const seg of curve.segments) {
    if (!seg.length) continue;
    lo = Math.min(lo, seg[0][0]);
    hi = Math.max(hi, seg[seg.length - 1][0]);
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

export function firstPoint(curve: SampledCurve): Point | null {
  for (const seg of curve.segments) if (seg.length) return seg[0];
  return null;
}

export function lastPoint(curve: SampledCurve): Point | null {
  for (let i = curve.segments.length - 1; i >= 0; i--) {
    const seg = curve.segments[i];
    if (seg.length) return seg[seg.length - 1];
  }
  return null;
}

/** All y where the curve crosses a vertical level t = level (linear interp). */
export function verticalCrossings(curve: SampledCurve, level: number, cap = 200): number[] {
  const ys: number[] = [];
  for (const seg of curve.segments) {
    for (let i = 0; i < seg.length - 1 && ys.length < cap; i++) {
      const d0 = seg[i][0] - level;
      const d1 = seg[i + 1][0] - level;
      if (d0 === 0) ys.push(seg[i][1]);
      else if (d0 * d1 < 0) {
        const f = d0 / (d0 - d1);
        ys.push(seg[i][1] + f * (seg[i + 1][1] - seg[i][1]));
      }
    }
  }
  return ys;
}

/** The y-extent a curve spans over its sampled points within [tMin, tMax]. */
export function yExtent(curve: SampledCurve, tMin: number, tMax: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const seg of curve.segments) {
    for (const [t, y] of seg) {
      if (t < tMin || t > tMax) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}

/** All t where the curve crosses a horizontal level y = level (linear interp). */
export function crossingsAt(curve: SampledCurve, level: number, cap = 200): number[] {
  const ts: number[] = [];
  for (const seg of curve.segments) {
    for (let i = 0; i < seg.length - 1 && ts.length < cap; i++) {
      const d0 = seg[i][1] - level;
      const d1 = seg[i + 1][1] - level;
      if (d0 === 0) ts.push(seg[i][0]);
      else if (d0 * d1 < 0) {
        const f = d0 / (d0 - d1);
        ts.push(seg[i][0] + f * (seg[i + 1][0] - seg[i][0]));
      }
    }
  }
  return ts;
}
