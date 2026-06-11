import type { EvalFunction } from 'mathjs';
import type { Point, SampledCurve } from './curve';

export interface SampleOpts {
  tMin: number;
  tMax: number;
  samples?: number;
  /** |value| above this is treated as off-to-infinity and breaks the segment. */
  blowup?: number;
  /** Visible y-range; a jump much larger than this between samples is an asymptote. */
  yMin?: number;
  yMax?: number;
}

/**
 * Sample an explicit function value(t) across the visible span. Non-finite
 * results (e.g. log of a negative, division by zero) and blow-ups break the
 * polyline into separate segments, giving free discontinuity handling.
 */
export function sampleFunction(
  compiled: EvalFunction,
  scope: Record<string, number>,
  opts: SampleOpts,
): SampledCurve {
  const { tMin, tMax } = opts;
  const samples = opts.samples ?? 1500;
  const blowup = opts.blowup ?? 1e6;
  const span = tMax - tMin;
  const h = span > 0 ? span / samples : 0.01;

  // Note: asymptotes (e.g. tan near π/2) are *defined* nearby — they are not
  // discontinuities. Genuine discontinuities (undefined points like sin(t)/t at 0
  // or the domain edge of sqrt(t²−4)) are where evaluation is non-finite. A more
  // accurate detector is tracked separately (see todo); here we only split on
  // non-finite / blow-up values.
  const segments: Point[][] = [];
  let current: Point[] = [];
  const local: Record<string, number> = { ...scope };

  const evalAt = (t: number): number => {
    local.t = t;
    try {
      const v = compiled.evaluate(local);
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
  const valid = (v: number) => Number.isFinite(v) && Math.abs(v) <= blowup;

  /** The valid point closest to the domain boundary between a (valid) and b
   * (invalid), so the curve reaches the edge (e.g. sqrt(t²−4) → y≈0 at ±2). */
  const edgePoint = (tValid: number, tInvalid: number): Point | null => {
    let lo = tValid;
    let hi = tInvalid;
    let best: Point | null = null;
    for (let k = 0; k < 32; k++) {
      const mid = (lo + hi) / 2;
      const m = evalAt(mid);
      if (valid(m)) {
        best = [mid, m];
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return best;
  };

  let prevT = NaN;
  let prevValid = false;
  for (let i = 0; i <= samples; i++) {
    const t = tMin + i * h;
    const num = evalAt(t);
    const ok = valid(num);
    if (ok) {
      // Entering the domain: prepend the boundary point.
      if (!prevValid && !Number.isNaN(prevT)) {
        const edge = edgePoint(t, prevT);
        if (edge) current.push(edge);
      }
      current.push([t, num]);
    } else {
      // Leaving the domain: append the boundary point, then break.
      if (prevValid) {
        const edge = edgePoint(prevT, t);
        if (edge) current.push(edge);
      }
      if (current.length) {
        segments.push(current);
        current = [];
      }
    }
    prevT = t;
    prevValid = ok;
  }
  if (current.length) segments.push(current);
  return { segments };
}
