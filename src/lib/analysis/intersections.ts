import type { SampledCurve } from '../solver/curve';
import type { Viewport } from '../../store/types';
import { evalCurveAt } from './eval';
import type { Feature } from './types';

type Seg = [number, number, number, number]; // x1, y1, x2, y2

/** Segment–segment crossing point, or null if they don't properly cross. */
function segSeg(a: Seg, b: Seg): [number, number] | null {
  const rx = a[2] - a[0];
  const ry = a[3] - a[1];
  const sx = b[2] - b[0];
  const sy = b[3] - b[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-15) return null;
  const qpx = b[0] - a[0];
  const qpy = b[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a[0] + t * rx, a[1] + t * ry];
  return null;
}

/** Flatten a curve's polylines into segments that overlap the viewport. */
function collectSegments(curve: SampledCurve, vp: Viewport): Seg[] {
  const out: Seg[] = [];
  for (const seg of curve.segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [x1, y1] = seg[i];
      const [x2, y2] = seg[i + 1];
      if (
        Math.max(x1, x2) < vp.tMin ||
        Math.min(x1, x2) > vp.tMax ||
        Math.max(y1, y2) < vp.yMin ||
        Math.min(y1, y2) > vp.yMax
      ) {
        continue;
      }
      out.push([x1, y1, x2, y2]);
    }
  }
  return out;
}

/**
 * General intersection of two arbitrary curves (works for multi-valued / implicit
 * curves like circles). Bins one curve's segments into a uniform grid over the
 * view, then tests the other curve's segments only against segments in the cells
 * they overlap — near-linear instead of O(N·M).
 */
export function curveIntersections(
  a: SampledCurve,
  b: SampledCurve,
  vp: Viewport,
  cap = 300,
): Feature[] {
  const segsA = collectSegments(a, vp);
  const segsB = collectSegments(b, vp);
  if (!segsA.length || !segsB.length) return [];

  const COLS = 64;
  const ROWS = 64;
  const w = vp.tMax - vp.tMin || 1;
  const hgt = vp.yMax - vp.yMin || 1;
  const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.floor(((x - vp.tMin) / w) * COLS)));
  const rowOf = (y: number) => Math.max(0, Math.min(ROWS - 1, Math.floor(((y - vp.yMin) / hgt) * ROWS)));

  const grid = new Map<number, number[]>();
  segsA.forEach((s, idx) => {
    const c0 = colOf(Math.min(s[0], s[2]));
    const c1 = colOf(Math.max(s[0], s[2]));
    const r0 = rowOf(Math.min(s[1], s[3]));
    const r1 = rowOf(Math.max(s[1], s[3]));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = c * ROWS + r;
        const arr = grid.get(key);
        if (arr) arr.push(idx);
        else grid.set(key, [idx]);
      }
    }
  });

  const out: Feature[] = [];
  const seen = new Set<string>();
  for (const sb of segsB) {
    const c0 = colOf(Math.min(sb[0], sb[2]));
    const c1 = colOf(Math.max(sb[0], sb[2]));
    const r0 = rowOf(Math.min(sb[1], sb[3]));
    const r1 = rowOf(Math.max(sb[1], sb[3]));
    const tested = new Set<number>();
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const arr = grid.get(c * ROWS + r);
        if (!arr) continue;
        for (const idx of arr) {
          if (tested.has(idx)) continue;
          tested.add(idx);
          const p = segSeg(segsA[idx], sb);
          if (p) {
            const key = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ kind: 'intersection', t: p[0], y: p[1] });
              if (out.length >= cap) return out;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Find intersections of two single-valued curves by scanning their difference
 * d(t) = A(t) − B(t) on a uniform grid across the view and refining each sign
 * change by bisection. Robust to the two curves having different t-sampling.
 */
export function computeIntersections(
  a: SampledCurve,
  b: SampledCurve,
  vp: Viewport,
  grid = 800,
): Feature[] {
  const out: Feature[] = [];
  const h = (vp.tMax - vp.tMin) / grid;
  if (!(h > 0)) return out;

  const diff = (t: number): number | null => {
    const ya = evalCurveAt(a, t);
    const yb = evalCurveAt(b, t);
    if (ya == null || yb == null) return null;
    return ya - yb;
  };

  let prevT = vp.tMin;
  let prevD = diff(prevT);
  for (let i = 1; i <= grid && out.length < 200; i++) {
    const t = vp.tMin + i * h;
    const d = diff(t);
    if (prevD != null && d != null) {
      if (prevD === 0) {
        const y = evalCurveAt(a, prevT);
        if (y != null) out.push({ kind: 'intersection', t: prevT, y });
      } else if (prevD * d < 0) {
        // Bisection refinement.
        let lo = prevT;
        let hi = t;
        let dlo = prevD;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          const dm = diff(mid);
          if (dm == null) break;
          if (dlo * dm <= 0) hi = mid;
          else {
            lo = mid;
            dlo = dm;
          }
        }
        const tc = (lo + hi) / 2;
        const y = evalCurveAt(a, tc);
        if (y != null) out.push({ kind: 'intersection', t: tc, y });
      }
    }
    prevT = t;
    prevD = d;
  }
  return out;
}
