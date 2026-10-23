import type { CurveResult } from '../compute';
import { compileNode } from '../math/compileCache';
import { verticalCrossings } from './eval';

/**
 * Compare a numerical ODE solution with an analytic one at the right panel's
 * slice t = sliceT: for each ODE row cut once by the slice, the function row
 * (cut once) closest to it, and their difference. Only pairs that agree to
 * within `tolerance` (relative) are reported, so an unrelated curve elsewhere
 * on the plot never shows a meaningless "error".
 */

export interface SliceValues {
  id: string;
  kind: 'ode' | 'function';
  /** The curve's values at the slice (one per crossing). */
  values: number[];
}

export interface SliceDiff {
  odeId: string;
  fnId: string;
  /** ODE value minus function value. */
  diff: number;
  /** |diff| relative to the function's magnitude (≥ 1). */
  rel: number;
}

/** Most differences shown at once. */
export const MAX_DIFFS = 3;

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/**
 * A difference for display: small values in scientific notation (`2.4×10⁻⁷`),
 * and anything below 1e-12 (round-off level) as `< 10⁻¹²`.
 */
export function formatDiff(d: number, sig = 2): string {
  if (!Number.isFinite(d)) return String(d);
  if (d === 0) return '0';
  const a = Math.abs(d);
  if (a < 1e-12) return '< 10⁻¹²';
  if (a >= 1e-3 && a < 1e5) return String(Number(d.toPrecision(Math.max(sig, 2))));
  const [m, e] = d.toExponential(Math.max(0, sig - 1)).split('e');
  const exp = String(Number(e)).split('').map((c) => SUP[c] ?? c).join('');
  return `${m}×10${exp}`;
}

export function sliceDifferences(items: SliceValues[], tolerance = 0.05): SliceDiff[] {
  const fns = items.filter((i) => i.kind === 'function' && i.values.length === 1);
  const out: SliceDiff[] = [];
  if (!fns.length) return out;
  for (const o of items) {
    if (o.kind !== 'ode' || o.values.length !== 1) continue;
    const y = o.values[0];
    let best: SliceDiff | null = null;
    for (const f of fns) {
      const v = f.values[0];
      const diff = y - v;
      const rel = Math.abs(diff) / Math.max(1, Math.abs(v));
      if (!best || rel < best.rel) best = { odeId: o.id, fnId: f.id, diff, rel };
    }
    if (best && Number.isFinite(best.diff) && best.rel <= tolerance) out.push(best);
    if (out.length >= MAX_DIFFS) break;
  }
  return out;
}

/**
 * A curve's values at t = `t` for the comparison: exact where possible (an
 * explicit function evaluated there, an ODE stepped there from its nearest
 * stored state), so the readout is the solver's error, not the polyline's
 * linear read-off. Falls back to the drawn polyline's crossings.
 */
export function exactSliceValues(res: CurveResult, t: number, scope: Record<string, number>): number[] {
  const vals = verticalCrossings(res.curve, t);
  if (vals.length !== 1) return vals;
  try {
    if (res.parsed.kind === 'ode') {
      const v = res.ode?.valueAt?.(t);
      return v != null ? [v] : vals;
    }
    if (res.parsed.kind === 'function') {
      const v = compileNode(res.parsed.node).evaluate({ ...scope, t });
      return typeof v === 'number' && Number.isFinite(v) ? [v] : vals;
    }
  } catch {
    /* fall back to the polyline */
  }
  return vals;
}
