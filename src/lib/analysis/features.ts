import type { Point, SampledCurve } from '../solver/curve';
import type { Viewport } from '../../store/types';
import { evalCurveAt, firstPoint, lastPoint } from './eval';
import type { Feature } from './types';

/** Vertex of the parabola through three points (for sub-sample extrema). */
function parabolaVertex(p0: Point, p1: Point, p2: Point): Point {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (denom === 0) return p1;
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const b =
    (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  if (a === 0) return p1;
  const vx = -b / (2 * a);
  // Only trust the vertex if it stays within the bracketing interval.
  if (vx < x0 || vx > x2) return p1;
  const c = y1 - a * x1 * x1 - b * x1;
  return [vx, a * vx * vx + b * vx + c];
}

/**
 * Detect notable features of a single curve over the current viewport:
 * local maxima/minima, zeros (t-axis crossings), the y-intercept (t = 0),
 * domain endpoints inside the view, and discontinuities between segments.
 */
export function computeFeatures(curve: SampledCurve, vp: Viewport): Feature[] {
  const out: Feature[] = [];
  const tEps = (vp.tMax - vp.tMin) * 0.004;
  const CAP = 300;

  for (const seg of curve.segments) {
    // Extrema.
    for (let i = 1; i < seg.length - 1 && out.length < CAP; i++) {
      const a = seg[i][1] - seg[i - 1][1];
      const b = seg[i + 1][1] - seg[i][1];
      if (a > 0 && b <= 0 && !(a === 0 && b === 0)) {
        const [t, y] = parabolaVertex(seg[i - 1], seg[i], seg[i + 1]);
        out.push({ kind: 'max', t, y });
      } else if (a < 0 && b >= 0 && !(a === 0 && b === 0)) {
        const [t, y] = parabolaVertex(seg[i - 1], seg[i], seg[i + 1]);
        out.push({ kind: 'min', t, y });
      }
    }
    // Zeros (sign changes of y).
    for (let i = 0; i < seg.length - 1 && out.length < CAP; i++) {
      const y0 = seg[i][1];
      const y1 = seg[i + 1][1];
      if (y0 === 0) {
        out.push({ kind: 'root', t: seg[i][0], y: 0 });
      } else if (y0 * y1 < 0) {
        const f = y0 / (y0 - y1);
        out.push({ kind: 'root', t: seg[i][0] + f * (seg[i + 1][0] - seg[i][0]), y: 0 });
      }
    }
  }

  // y-intercept (value at t = 0).
  if (vp.tMin <= 0 && vp.tMax >= 0) {
    const y = evalCurveAt(curve, 0);
    if (y != null) out.push({ kind: 'yIntercept', t: 0, y });
  }

  // Domain edges between segments are discontinuities at the curve's *actual*
  // (sampler-refined) boundary points — e.g. sqrt(t²−4) ends at (±2, 0). Reading
  // them off the curve keeps the marker on the curve and stable while zooming.
  // Asymptotes (tan) blow up off-screen, so their boundary points are excluded.
  const ySpan = vp.yMax - vp.yMin;
  const yMargin = ySpan * 0.5;
  const onScreen = (y: number) => y >= vp.yMin - yMargin && y <= vp.yMax + yMargin;
  for (let i = 0; i < curve.segments.length - 1 && out.length < CAP; i++) {
    const a = curve.segments[i];
    const b = curve.segments[i + 1];
    if (!a.length || !b.length) continue;
    const aEnd = a[a.length - 1];
    const bStart = b[0];
    if (onScreen(aEnd[1])) out.push({ kind: 'discontinuity', t: aEnd[0], y: aEnd[1] });
    if (onScreen(bStart[1])) out.push({ kind: 'discontinuity', t: bStart[0], y: bStart[1] });
  }

  // Endpoints: where the whole curve's domain ends *inside* the view (on-screen).
  const fp = firstPoint(curve);
  const lp = lastPoint(curve);
  if (fp && fp[0] > vp.tMin + tEps && onScreen(fp[1])) out.push({ kind: 'endpoint', t: fp[0], y: fp[1] });
  if (lp && lp[0] < vp.tMax - tEps && onScreen(lp[1])) out.push({ kind: 'endpoint', t: lp[0], y: lp[1] });

  return out;
}
