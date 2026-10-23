import { rk4Step, isFiniteVec, maxAbs, type DerivFn } from './rk4';
import { solveAt, type Impulse } from './integrate';

/**
 * Textbook one-step methods with an explicit step size h, for the "Show steps"
 * teaching view: the discrete points y_n are drawn over the accurate solution
 * and compared with it (global error |y_h − y_ref|).
 */
export type StepMethod = 'euler' | 'heun' | 'rk4';
export const STEP_METHODS: readonly StepMethod[] = ['euler', 'heun', 'rk4'];
export const STEP_METHOD_LABELS: Record<StepMethod, string> = { euler: 'Euler', heun: 'Heun', rk4: 'RK4' };
/** Order of accuracy p (global error = O(h^p)). */
export const STEP_ORDER: Record<StepMethod, number> = { euler: 1, heun: 2, rk4: 4 };
/** Steps drawn per direction at most (a tiny h over a wide window stops early). */
export const MAX_SHOWN_STEPS = 2000;
export const DEFAULT_STEP_SIZE = 0.5;
export const MIN_STEP_SIZE = 1e-3;
export const MAX_STEP_SIZE = 100;

export function methodStep(method: StepMethod, f: DerivFn, t: number, y: number[], h: number): number[] {
  const n = y.length;
  if (method === 'rk4') return rk4Step(f, t, y, h);
  const k1 = f(t, y);
  const e = new Array<number>(n);
  for (let i = 0; i < n; i++) e[i] = y[i] + h * k1[i];
  if (method === 'euler') return e;
  // Heun (improved Euler / explicit trapezoid): average the slopes at both ends.
  const k2 = f(t + h, e);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 2) * (k1[i] + k2[i]);
  return out;
}

export interface StepRun {
  /** Step times, ascending (t0 included). */
  ts: number[];
  /** Full state at each step time. */
  ys: number[][];
  /** A direction stopped at MAX_SHOWN_STEPS before the window edge. */
  truncated: boolean;
}

/**
 * March with a fixed h from t0 forward to tMax and backward to tMin (the last
 * step lands exactly on neither edge: steps keep their size so the picture is
 * the textbook one). Impulses are added when a step crosses them.
 */
export function runSteps(
  f: DerivFn,
  method: StepMethod,
  t0: number,
  y0: number[],
  h: number,
  tMin: number,
  tMax: number,
  opts: { impulses?: Impulse[]; blowup?: number } = {},
): StepRun {
  const blowup = opts.blowup ?? 1e6;
  const impulses = opts.impulses ?? [];
  let truncated = false;
  const march = (dir: number, tEnd: number): { ts: number[]; ys: number[][] } => {
    const ts = [t0];
    const ys = [y0.slice()];
    let t = t0;
    let y = y0.slice();
    if (dir > 0) for (const p of impulses) if (p.t === t0) y[p.index] += p.amount(y);
    if (dir > 0) ys[0] = y.slice();
    for (let i = 0; i < MAX_SHOWN_STEPS; i++) {
      // Include the step that reaches past the edge so the polyline spans the view.
      if (dir * (t - tEnd) >= 0) return { ts, ys };
      const tn = t0 + dir * h * (i + 1);
      let next = methodStep(method, f, t, y, dir * h);
      for (const p of impulses) {
        const inside = dir > 0 ? p.t > t && p.t <= tn : p.t < t && p.t >= tn;
        if (inside && p.t !== t0) {
          const amt = p.amount(next);
          if (Number.isFinite(amt)) next = next.map((v, j) => (j === p.index ? v + dir * amt : v));
        }
      }
      if (!isFiniteVec(next) || maxAbs(next) > blowup) return { ts, ys };
      t = tn;
      y = next;
      ts.push(t);
      ys.push(y);
    }
    if (dir * (t - tEnd) < 0) truncated = true;
    return { ts, ys };
  };
  const fwd = t0 < tMax ? march(1, tMax) : { ts: [t0], ys: [y0.slice()] };
  const bwd = t0 > tMin ? march(-1, tMin) : { ts: [t0], ys: [y0.slice()] };
  const ts: number[] = [];
  const ys: number[][] = [];
  for (let i = bwd.ts.length - 1; i >= 1; i--) {
    ts.push(bwd.ts[i]);
    ys.push(bwd.ys[i]);
  }
  // t0 itself: the (post-impulse) forward start, or the backward start.
  ts.push(t0);
  ys.push(fwd.ys[0]);
  for (let i = 1; i < fwd.ts.length; i++) {
    ts.push(fwd.ts[i]);
    ys.push(fwd.ys[i]);
  }
  return { ts, ys, truncated };
}

/** Global error |y_h(t_n) − y(t_n)| of component `idx` at each step (reference by DOPRI5). */
export function globalErrors(
  f: DerivFn,
  run: StepRun,
  t0: number,
  y0: number[],
  idx: number,
  opts: { impulses?: Impulse[]; breaks?: number[] } = {},
): number[] {
  const ref = solveAt(f, t0, y0, run.ts, { impulses: opts.impulses, breaks: opts.breaks });
  return run.ts.map((_, i) => Math.abs(run.ys[i][idx] - ref[i][idx]));
}
