import type { MathNode } from 'mathjs';
import type { Viewport } from '../../store/types';
import { compileNode } from '../math/compileCache';
import type { Feature } from './types';

/**
 * Find removable holes of an explicit function f(t) — e.g. sin(t)/t at 0, which
 * is undefined only at a single point and looks perfectly smooth, so it can't be
 * found by sampling. We locate candidate points symbolically (zeros of `/`
 * denominators) and classify each by evaluating f a *fixed* small distance to
 * either side (independent of the sample grid, so markers don't flicker while
 * zooming): bounded & close on both sides → hole; blow up → asymptote (skipped;
 * those, and sqrt/log domain edges, are handled from the curve's own segments).
 */
export function detectSingularities(
  node: MathNode,
  scope: Record<string, number>,
  vp: Viewport,
): Feature[] {
  const denoms: MathNode[] = [];
  node.traverse((n) => {
    const anyN = n as unknown as { type: string; op?: string; args?: MathNode[] };
    if (anyN.type === 'OperatorNode' && anyN.op === '/' && anyN.args?.[1]) {
      denoms.push(anyN.args[1]);
    }
  });
  if (!denoms.length) return [];

  const fc = compileNode(node);
  const evalF = (t: number): number => {
    try {
      const v = fc.evaluate({ ...scope, t });
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };

  const span = vp.tMax - vp.tMin || 1;
  const ySpan = vp.yMax - vp.yMin || 1;
  const eps = span * 1e-4; // fixed probe distance, grid-independent
  const bounded = (y: number) => Number.isFinite(y) && Math.abs(y) < ySpan * 20;
  const out: Feature[] = [];
  const seen = new Set<number>();
  const N = 500;
  const dt = span / N;

  const classify = (ts: number) => {
    const key = Math.round(ts / (span * 1e-3));
    if (seen.has(key)) return;
    seen.add(key);
    const fl = evalF(ts - eps);
    const fr = evalF(ts + eps);
    // A removable hole: bounded and continuous (close) on both sides.
    if (bounded(fl) && bounded(fr) && Math.abs(fl - fr) < ySpan * 0.05) {
      out.push({ kind: 'discontinuity', t: ts, y: (fl + fr) / 2 });
    }
    // Otherwise it's a pole/asymptote (1/t, tan) → not a discontinuity.
  };

  for (const g of denoms) {
    const gc = compileNode(g);
    const evalG = (t: number): number => {
      try {
        const v = gc.evaluate({ ...scope, t });
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    let prevT = vp.tMin;
    let prevG = evalG(prevT);
    for (let i = 1; i <= N && out.length < 60; i++) {
      const t = vp.tMin + i * dt;
      const g1 = evalG(t);
      if (prevG === 0) classify(prevT);
      else if (Number.isFinite(prevG) && Number.isFinite(g1) && prevG * g1 < 0) {
        let lo = prevT;
        let hi = t;
        let glo = prevG;
        for (let k = 0; k < 50; k++) {
          const mid = (lo + hi) / 2;
          const gm = evalG(mid);
          if (!Number.isFinite(gm)) {
            hi = mid;
            continue;
          }
          if (glo * gm <= 0) hi = mid;
          else {
            lo = mid;
            glo = gm;
          }
        }
        classify((lo + hi) / 2);
      }
      prevT = t;
      prevG = g1;
    }
  }
  return out;
}
