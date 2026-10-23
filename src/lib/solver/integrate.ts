import { rk4Step, isFiniteVec, maxAbs, type DerivFn } from './rk4';
import { adaptiveMarch, newInfo, type IntegrateInfo } from './adaptive';

export type { IntegrateInfo } from './adaptive';

/** Trajectory of a (possibly coupled) system as continuous segments of states. */
export interface TrajSegment {
  ts: number[];
  /** ys[i] is the full state vector at ts[i]. A repeated time marks a jump
   * (an impulse): the state before it, then the state after it. */
  ys: number[][];
}
export type Trajectory = TrajSegment[];

/**
 * Which integrator draws an ODE.
 *  - auto:  Dormand–Prince 5(4) with error control and dense output, switching
 *           to a Rosenbrock (implicit) method when the problem turns out stiff.
 *  - rk45:  Dormand–Prince only.
 *  - rk4:   classic fixed-step RK4, ~`samples` steps across the window.
 *  - euler: fixed-step forward Euler at the same step (for comparison).
 */
export type SolverMethod = 'auto' | 'rk45' | 'rk4' | 'euler';
export const SOLVER_METHODS: readonly SolverMethod[] = ['auto', 'rk45', 'rk4', 'euler'];
/** The solver used when an entry doesn't choose one (see the PR #3 benchmarks). */
export const DEFAULT_SOLVER: SolverMethod = 'rk4';

/** A Dirac impulse: at time t, state component `index` jumps by amount(state before). */
export interface Impulse {
  t: number;
  index: number;
  amount: (y: number[]) => number;
}

export interface IntegrateOpts {
  t0: number;
  y0: number[];
  tMin: number;
  tMax: number;
  /** Target number of steps (fixed methods) / output samples across the visible span. */
  samples?: number;
  /** |state| above this ends a segment (asymptote / blow-up). */
  blowup?: number;
  /** Integrator (default DEFAULT_SOLVER). */
  method?: SolverMethod;
  /** Impulses (delta forcing) applied as jumps; the step is split there. */
  impulses?: Impulse[];
  /** Times where the right-hand side is discontinuous (steps): the step is split there. */
  breaks?: number[];
  /** Error tolerances of the adaptive methods. */
  rtol?: number;
  atol?: number;
  /** Filled with step counts etc. when given. */
  info?: IntegrateInfo;
}

/** Fixed-step cap per direction (also bounds the coarse step when t0 is far away). */
const STEP_CAP = 8000;
/** Accepted-step budget per direction for the adaptive methods. */
const ADAPTIVE_CAP = 20000;
/** Tolerances of the adaptive methods when drawing (scripts/bench-ode.ts tunes /
 * overrides these; see the PR #3 benchmarks for how they were chosen). */
export const TOLERANCES = { rtol: 1e-9, atol: 1e-11 };

function eulerStep(f: DerivFn, t: number, y: number[], h: number): number[] {
  const d = f(t, y);
  const out = new Array<number>(y.length);
  for (let i = 0; i < y.length; i++) out[i] = y[i] + h * d[i];
  return out;
}

/**
 * The right-hand side for one piece [ta, tb] between breakpoints: stage times
 * at a breakpoint end are nudged just inside the piece, so a step function
 * (H(t − a) is 1 at t = a) is evaluated on the correct side of its jump.
 */
function pieceDeriv(f: DerivFn, ta: number, tb: number, startIsBreak: boolean, endIsBreak: boolean): DerivFn {
  if (!startIsBreak && !endIsBreak) return f;
  const dir = tb >= ta ? 1 : -1;
  const eps = Math.min(1e-9 * Math.max(1, Math.abs(ta), Math.abs(tb)), Math.abs(tb - ta) / 4);
  const lo = startIsBreak ? ta + dir * eps : ta;
  const hi = endIsBreak ? tb - dir * eps : tb;
  return (t, y) => f(dir * (t - lo) < 0 ? lo : dir * (t - hi) > 0 ? hi : t, y);
}

/** Evenly spaced times strictly between a and b (n intervals). */
function evenly(a: number, b: number, n: number, out: number[]) {
  for (let i = 1; i < n; i++) out.push(a + ((b - a) * i) / n);
}

/**
 * Output times for the adaptive methods from t0 towards tStop (a window edge):
 * `hWindow` apart inside the window, coarser (≤ 400 points) on the way to it.
 */
function outputGrid(t0: number, tStop: number, tMin: number, tMax: number, hWindow: number): number[] {
  const out: number[] = [];
  const dir = tStop >= t0 ? 1 : -1;
  let start = t0;
  const edge = dir > 0 ? tMin : tMax;
  if (dir * (edge - t0) > 0) {
    // t0 lies outside the window: reach the near edge first.
    const len = Math.abs(edge - t0);
    const n = Math.max(1, Math.ceil(len / Math.max(hWindow, len / 400)));
    evenly(t0, edge, n, out);
    out.push(edge);
    start = edge;
  }
  const len = Math.abs(tStop - start);
  const n = Math.max(1, Math.ceil(len / hWindow - 1e-9));
  evenly(start, tStop, n, out);
  return out;
}

/**
 * Integrate dY/dt = deriv(t, Y) from the initial state at t0, covering the
 * visible span [tMin, tMax]. Integrates backward and forward from t0 and stitches
 * the two halves into a single ascending polyline (breaking on blow-up).
 */
export function integrateSystem(deriv: DerivFn, opts: IntegrateOpts): Trajectory {
  const { t0, y0, tMin, tMax } = opts;
  const samples = opts.samples ?? 1500;
  const blowup = opts.blowup ?? 1e6;
  const method = opts.method ?? DEFAULT_SOLVER;
  const span = tMax - tMin;
  // Target resolution within the visible window.
  const hWindow = span > 0 ? span / samples : 0.01;
  const info = opts.info ?? newInfo();
  const impulses = opts.impulses ?? [];
  const breaks = opts.breaks ?? [];
  const rtol = opts.rtol ?? TOLERANCES.rtol;
  const atol = opts.atol ?? TOLERANCES.atol;
  // Count right-hand-side evaluations for the fixed methods too.
  const f: DerivFn = (t, y) => {
    info.fevals++;
    return deriv(t, y);
  };

  const marchTo = (tStop: number): TrajSegment => {
    const dist = Math.abs(tStop - t0);
    if (dist < 1e-15) return { ts: [t0], ys: [y0.slice()] };
    const dir = tStop > t0 ? 1 : -1;
    const ahead = (a: number) => dir * (a - t0) > 0 && dir * (tStop - a) > 0;
    // Impulses act at t ≥ t0 going forward (the initial state is the state just
    // before t0), and are undone at t < t0 going backward.
    const kicks = impulses.filter((p) => (dir > 0 ? p.t >= t0 && p.t < tStop : p.t < t0 && p.t > tStop));
    const evTimes = [...new Set([...kicks.map((p) => p.t), ...breaks.filter(ahead)])]
      .filter((a) => a !== t0)
      .sort((a, b) => dir * (a - b));
    const ts: number[] = [t0];
    const ys: number[][] = [y0.slice()];
    let t = t0;
    let y = y0.slice();

    const kick = (at: number) => {
      const here = kicks.filter((p) => p.t === at);
      if (!here.length) return;
      const next = y.slice();
      for (const p of here) {
        const amt = p.amount(dir > 0 ? y : next);
        if (Number.isFinite(amt)) next[p.index] += dir * amt;
      }
      y = next;
      ts.push(at);
      ys.push(y.slice());
    };
    if (dir > 0) kick(t0);

    const fixed = method === 'rk4' || method === 'euler';
    const step = method === 'euler' ? eulerStep : rk4Step;
    // Fixed methods: one step size for the whole direction (exactly the old
    // behaviour when nothing splits the span).
    const steps = Math.min(STEP_CAP, Math.max(8, Math.ceil(dist / hWindow)));
    const hFixed = dist / steps;
    const grid = fixed ? [] : outputGrid(t0, tStop, tMin, tMax, hWindow);
    let gi = 0;
    let stiff = false;
    let budget = ADAPTIVE_CAP;

    for (const te of [...evTimes, tStop]) {
      const len = Math.abs(te - t);
      const fp = pieceDeriv(f, t, te, t !== t0, te !== tStop);
      if (fixed) {
        const n = evTimes.length ? Math.max(1, Math.ceil(len / hFixed - 1e-9)) : steps;
        const h = (te - t) / n;
        const tStart = t;
        let blew = false;
        for (let i = 0; i < n; i++) {
          const next = step(fp, t, y, h);
          if (!isFiniteVec(next) || maxAbs(next) > blowup) {
            blew = true;
            break;
          }
          t = evTimes.length ? (i === n - 1 ? te : tStart + h * (i + 1)) : t + h;
          y = next;
          info.steps++;
          ts.push(t);
          ys.push(y.slice());
        }
        if (blew) {
          info.stopped = 'blowup';
          break;
        }
        t = te;
      } else {
        const outs: number[] = [];
        while (gi < grid.length && dir * (grid[gi] - te) < 0) {
          if (dir * (grid[gi] - t) > 0) outs.push(grid[gi]);
          gi++;
        }
        const before = info.steps;
        const res = adaptiveMarch(fp, t, y, te, outs, {
          rtol,
          atol,
          hmax: Math.max(16 * hWindow, dist / 256),
          blowup,
          maxSteps: budget,
          stiffSwitch: method === 'auto',
          stiff,
          info,
        });
        budget -= info.steps - before;
        for (let i = 0; i < res.ts.length; i++) {
          ts.push(res.ts[i]);
          ys.push(res.ys[i]);
        }
        if (!res.ok) break;
        stiff = res.stiff;
        t = te;
        y = res.yEnd.slice();
      }
      if (te !== tStop) kick(te);
    }
    return { ts, ys };
  };

  const fwd = t0 < tMax ? marchTo(tMax) : { ts: [t0], ys: [y0.slice()] };
  const bwd = t0 > tMin ? marchTo(tMin) : { ts: [t0], ys: [y0.slice()] };

  // Stitch: reversed backward half (ascending up to t0) + forward half (drop dup t0).
  const ts: number[] = [];
  const ys: number[][] = [];
  for (let i = bwd.ts.length - 1; i >= 0; i--) {
    ts.push(bwd.ts[i]);
    ys.push(bwd.ys[i]);
  }
  for (let i = 1; i < fwd.ts.length; i++) {
    ts.push(fwd.ts[i]);
    ys.push(fwd.ys[i]);
  }

  if (ts.length < 2) return [];
  return [{ ts, ys }];
}

/**
 * The state at each of `times` (any order, any side of t0), accurately (dense
 * output of the adaptive method, tight tolerances). NaN-filled where the solution
 * blew up before reaching the time. Used for reference solutions (global error)
 * and shooting.
 */
export function solveAt(
  deriv: DerivFn,
  t0: number,
  y0: number[],
  times: number[],
  opts: { rtol?: number; atol?: number; impulses?: Impulse[]; breaks?: number[]; blowup?: number; method?: SolverMethod } = {},
): number[][] {
  const out: number[][] = times.map(() => y0.map(() => NaN));
  const blowup = opts.blowup ?? 1e12;
  const impulses = opts.impulses ?? [];
  const breaks = opts.breaks ?? [];
  for (const dir of [1, -1]) {
    const idx = times
      .map((t, i) => [t, i] as const)
      .filter(([t]) => (dir > 0 ? t >= t0 : t < t0))
      .sort((a, b) => dir * (a[0] - b[0]));
    if (!idx.length) continue;
    const tStop = idx[idx.length - 1][0];
    const kicks = impulses.filter((p) => (dir > 0 ? p.t >= t0 && p.t < tStop : p.t < t0 && p.t > tStop));
    const ev = [...new Set([...kicks.map((p) => p.t), ...breaks.filter((b) => dir * (b - t0) > 0 && dir * (tStop - b) > 0)])]
      .filter((a) => a !== t0)
      .sort((a, b) => dir * (a - b));
    let t = t0;
    let y = y0.slice();
    const kick = (at: number) => {
      const next = y.slice();
      for (const p of kicks) if (p.t === at) {
        const amt = p.amount(dir > 0 ? y : next);
        if (Number.isFinite(amt)) next[p.index] += dir * amt;
      }
      y = next;
    };
    if (dir > 0) kick(t0);
    let k = 0;
    // Exactly-at-t0 requests.
    while (k < idx.length && idx[k][0] === t0) out[idx[k++][1]] = y.slice();
    const span = Math.abs(tStop - t0) || 1;
    for (const te of [...ev, tStop]) {
      const outs: number[] = [];
      const slots: number[] = [];
      // Times strictly inside (t, te); times equal to te are taken from yEnd.
      while (k < idx.length && dir * (idx[k][0] - te) < 0) {
        outs.push(idx[k][0]);
        slots.push(idx[k][1]);
        k++;
      }
      const res = adaptiveMarch(pieceDeriv(deriv, t, te, t !== t0, te !== tStop), t, y, te, outs, {
        rtol: opts.rtol ?? 1e-10,
        atol: opts.atol ?? 1e-12,
        hmax: span / 8,
        blowup,
        maxSteps: 50000,
        stiffSwitch: (opts.method ?? 'auto') === 'auto',
      });
      for (let i = 0; i < slots.length && i < res.ts.length; i++) out[slots[i]] = res.ys[i];
      if (!res.ok) return out;
      t = te;
      y = res.yEnd.slice();
      // The state at an impulse time is the state just after it (right-continuous).
      if (dir > 0 && te !== tStop) kick(te);
      while (k < idx.length && idx[k][0] === te) out[idx[k++][1]] = y.slice();
      if (dir < 0 && te !== tStop) kick(te);
    }
  }
  return out;
}
