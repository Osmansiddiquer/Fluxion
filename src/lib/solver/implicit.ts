import type { EvalFunction } from 'mathjs';
import type { Viewport } from '../../store/types';
import type { Point, SampledCurve } from './curve';

export interface ImplicitOpts {
  cellsX?: number;
  cellsY?: number;
}

/**
 * Plot the zero contour of F(t, y) = 0 with marching squares over the viewport.
 * Returns many short segments (one or two per straddling cell). Cells with any
 * non-finite corner are skipped, so singularities don't create spurious lines.
 */
export function sampleImplicit(
  compiled: EvalFunction,
  scope: Record<string, number>,
  vp: Viewport,
  opts: ImplicitOpts = {},
): SampledCurve {
  const nx = Math.max(8, Math.min(360, opts.cellsX ?? 220));
  const ny = Math.max(8, Math.min(360, opts.cellsY ?? 180));
  const dt = (vp.tMax - vp.tMin) / nx;
  const dy = (vp.yMax - vp.yMin) / ny;

  const local: Record<string, number> = { ...scope };
  const evalF = (t: number, y: number): number => {
    local.t = t;
    local.y = y;
    let v: unknown;
    try {
      v = compiled.evaluate(local);
    } catch {
      return NaN;
    }
    return typeof v === 'number' ? v : NaN;
  };

  // Pre-evaluate grid node values: vals[j * (nx+1) + i] at (t_i, y_j).
  const cols = nx + 1;
  const vals = new Float64Array(cols * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    const y = vp.yMin + j * dy;
    for (let i = 0; i <= nx; i++) {
      vals[j * cols + i] = evalF(vp.tMin + i * dt, y);
    }
  }

  const segments: Point[][] = [];
  const interp = (
    va: number,
    vb: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): Point => {
    const f = va / (va - vb);
    return [ax + f * (bx - ax), ay + f * (by - ay)];
  };

  for (let j = 0; j < ny; j++) {
    const y0 = vp.yMin + j * dy;
    const y1 = y0 + dy;
    for (let i = 0; i < nx; i++) {
      const t0 = vp.tMin + i * dt;
      const t1 = t0 + dt;
      const vBL = vals[j * cols + i];
      const vBR = vals[j * cols + i + 1];
      const vTL = vals[(j + 1) * cols + i];
      const vTR = vals[(j + 1) * cols + i + 1];
      if (!Number.isFinite(vBL) || !Number.isFinite(vBR) || !Number.isFinite(vTL) || !Number.isFinite(vTR)) {
        continue;
      }

      // Crossing points on the four edges, in order: bottom, right, top, left.
      const pts: Point[] = [];
      if ((vBL < 0) !== (vBR < 0)) pts.push(interp(vBL, vBR, t0, y0, t1, y0));
      if ((vBR < 0) !== (vTR < 0)) pts.push(interp(vBR, vTR, t1, y0, t1, y1));
      if ((vTL < 0) !== (vTR < 0)) pts.push(interp(vTL, vTR, t0, y1, t1, y1));
      if ((vBL < 0) !== (vTL < 0)) pts.push(interp(vBL, vTL, t0, y0, t0, y1));

      if (pts.length === 2) {
        segments.push([pts[0], pts[1]]);
      } else if (pts.length === 4) {
        segments.push([pts[0], pts[1]]);
        segments.push([pts[2], pts[3]]);
      }
    }
  }

  return { segments };
}
