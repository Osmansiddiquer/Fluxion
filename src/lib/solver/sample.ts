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
  /** Piecewise branch id at a scope (see branchOf): switches are located exactly. */
  branch?: (scope: Record<string, number>) => number;
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

  // Piecewise: which branch each sample takes. Where it switches between two
  // defined samples, bisect to the switch point: a jump ends the segment there
  // (no vertical join), a continuous join (|x| at 0) gets its exact corner.
  const branch = opts.branch;
  const branchAt = (t: number): number => {
    local.t = t;
    return branch!(local);
  };
  const ySpan = opts.yMax != null && opts.yMin != null ? Math.abs(opts.yMax - opts.yMin) : 0;
  const jumpTol = Math.max(1e-9, ySpan * 1e-6);
  const switchAt = (t0: number, t1: number, b0: number): void => {
    let lo = t0;
    let hi = t1;
    for (let k = 0; k < 48 && hi - lo > 0; k++) {
      const mid = (lo + hi) / 2;
      if (mid <= lo || mid >= hi) break;
      if (branchAt(mid) === b0) lo = mid;
      else hi = mid;
    }
    const yLo = evalAt(lo);
    const yHi = evalAt(hi);
    if (valid(yLo) && lo !== current[current.length - 1]?.[0]) current.push([lo, yLo]);
    if (!valid(yLo) || !valid(yHi) || Math.abs(yHi - yLo) > jumpTol) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (valid(yHi)) current.push([hi, yHi]);
  };

  let prevT = NaN;
  let prevValid = false;
  let prevBranch = 0;
  for (let i = 0; i <= samples; i++) {
    const t = tMin + i * h;
    const num = evalAt(t);
    const ok = valid(num);
    if (ok) {
      const b = branch ? branchAt(t) : 0;
      // Entering the domain: prepend the boundary point.
      if (!prevValid && !Number.isNaN(prevT)) {
        const edge = edgePoint(t, prevT);
        if (edge) current.push(edge);
      } else if (branch && prevValid && b !== prevBranch) {
        switchAt(prevT, t, prevBranch);
      }
      prevBranch = b;
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
