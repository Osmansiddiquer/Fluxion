import { isFiniteVec, maxAbs, type DerivFn } from './rk4';
import { dopriStep, initialStep, type StepAttempt } from './dopri5';
import { rosenbrockStep } from './stiff';

/** Counters an integration fills in (benchmarks, tests, the Numerics readout). */
export interface IntegrateInfo {
  /** Accepted steps. */
  steps: number;
  rejected: number;
  /** Right-hand-side evaluations (including Jacobian columns). */
  fevals: number;
  /** The stiffness test fired and the implicit method took over. */
  stiff: boolean;
  /** Stopped before the end: blow-up, a singularity or the step budget. */
  stopped?: 'blowup' | 'singular' | 'budget';
}

/** Tolerance floor of the implicit (2nd-order) method. */
export const STIFF_RTOL = 1e-6;
export const STIFF_ATOL = 1e-9;

export function newInfo(): IntegrateInfo {
  return { steps: 0, rejected: 0, fevals: 0, stiff: false };
}

export interface AdaptiveOpts {
  rtol: number;
  atol: number;
  /** Largest |h|. */
  hmax: number;
  /** |state| above this ends the march (asymptote / blow-up). */
  blowup: number;
  /** Accepted-step budget for this march. */
  maxSteps: number;
  /** auto: start explicit (DOPRI5), switch to Rosenbrock when the stiffness test fires. */
  stiffSwitch: boolean;
  /** Use the implicit method from the start (carried over after a switch). */
  stiff?: boolean;
  info?: IntegrateInfo;
}

export interface MarchResult {
  /** Output times (the requested ones reached, then tEnd if reached). */
  ts: number[];
  ys: number[][];
  /** Reached tEnd. */
  ok: boolean;
  /** State at tEnd (when ok). */
  yEnd: number[];
  /** Whether the implicit method was in use at the end. */
  stiff: boolean;
}

/**
 * Integrate from (t0, y0) to tEnd with error control, sampling the dense output
 * at `outTimes` (strictly between t0 and tEnd, ordered in the direction of
 * travel) and finally at tEnd itself.
 */
export function adaptiveMarch(
  f: DerivFn,
  t0: number,
  y0: number[],
  tEnd: number,
  outTimes: number[],
  opts: AdaptiveOpts,
): MarchResult {
  const info = opts.info;
  const ts: number[] = [];
  const ys: number[][] = [];
  const dir = tEnd >= t0 ? 1 : -1;
  let stiff = !!opts.stiff;
  if (tEnd === t0) return { ts: [t0], ys: [y0.slice()], ok: true, yEnd: y0.slice(), stiff };

  const n = y0.length;
  let t = t0;
  let y = y0.slice();
  let f0 = f(t, y);
  if (info) info.fevals++;
  if (!isFiniteVec(f0)) {
    if (info) info.stopped = 'singular';
    return { ts, ys, ok: false, yEnd: y, stiff };
  }
  const { rtol, atol, blowup } = opts;
  const hmax = Math.max(opts.hmax, 1e-12);
  let h = dir * initialStep(f, t, y, f0, dir, Math.min(hmax, Math.abs(tEnd - t0)), rtol, atol, stiff ? 2 : 5);
  if (info) info.fevals++;
  let facold = 1e-4;
  let lastRejected = false;
  let iasti = 0;
  let nonsti = 0;
  let k = 0;
  let accepted = 0;

  while (dir * (tEnd - t) > 0) {
    if (accepted >= opts.maxSteps) {
      if (info) info.stopped = 'budget';
      return { ts, ys, ok: false, yEnd: y, stiff };
    }
    const hmin = 1e-13 * Math.max(1, Math.abs(t));
    if (Math.abs(h) > hmax) h = dir * hmax;
    let last = false;
    if (dir * (t + h - tEnd) >= -hmin) {
      h = tEnd - t;
      last = true;
    }
    let att: StepAttempt | null;
    const implicit = stiff;
    if (implicit) {
      // A 2nd-order method: plot-level tolerances keep stiff runs fast.
      att = rosenbrockStep(f, t, y, f0, h, Math.max(rtol, STIFF_RTOL), Math.max(atol, STIFF_ATOL));
      if (info) info.fevals += n + 3;
    } else {
      att = dopriStep(f, t, y, f0, h, rtol, atol);
      if (info) info.fevals += 6;
    }
    const err = att ? att.err : NaN;
    if (!att || !Number.isFinite(err) || !isFiniteVec(att.y)) {
      // A stage left the domain (or the matrix was singular): shrink hard.
      h *= 0.25;
      lastRejected = true;
      if (info) info.rejected++;
      if (Math.abs(h) < hmin) {
        if (info) info.stopped = 'singular';
        return { ts, ys, ok: false, yEnd: y, stiff };
      }
      continue;
    }

    if (err <= 1) {
      const tNew = last ? tEnd : t + h;
      // Dense output at the requested times inside this step.
      while (k < outTimes.length && dir * (outTimes[k] - tNew) < 0) {
        const theta = (outTimes[k] - t) / h;
        const yo = att.dense(theta);
        if (!isFiniteVec(yo) || maxAbs(yo) > blowup) {
          if (info) info.stopped = 'blowup';
          return { ts, ys, ok: false, yEnd: y, stiff };
        }
        ts.push(outTimes[k]);
        ys.push(yo);
        k++;
      }
      if (maxAbs(att.y) > blowup) {
        if (info) info.stopped = 'blowup';
        return { ts, ys, ok: false, yEnd: y, stiff };
      }
      // Requested times that coincide with tNew (within rounding) are emitted as tNew.
      while (k < outTimes.length && dir * (outTimes[k] - tNew) <= 0) k++;
      accepted++;
      if (info) info.steps++;

      // Stiffness test (Hairer): h·|λ| beyond DOPRI5's stability boundary for
      // 15 accepted steps in a row means the step is limited by stability.
      if (!stiff && opts.stiffSwitch && Number.isFinite(att.hLambda)) {
        if (att.hLambda > 3.25) {
          nonsti = 0;
          iasti++;
          if (iasti >= 15) {
            stiff = true;
            if (info) info.stiff = true;
          }
        } else {
          nonsti++;
          if (nonsti >= 6) iasti = 0;
        }
      }

      // Step-size update.
      let hNew: number;
      if (!implicit) {
        // DOPRI5 PI controller (order 5).
        const fac11 = Math.pow(err, 0.17);
        let fac = fac11 / Math.pow(facold, 0.04);
        fac = Math.max(0.2, Math.min(10, fac / 0.9));
        hNew = h / fac;
        facold = Math.max(err, 1e-4);
      } else {
        const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.8 * Math.pow(err, -1 / 3)));
        hNew = h * fac;
      }
      if (lastRejected && Math.abs(hNew) > Math.abs(h)) hNew = h;
      lastRejected = false;

      t = tNew;
      y = att.y;
      f0 = att.f;
      h = hNew;
      if (last) break;
    } else {
      lastRejected = true;
      if (info) info.rejected++;
      const shrink = implicit
        ? Math.max(0.1, 0.8 * Math.pow(err, -1 / 3))
        : 1 / Math.min(5, Math.pow(err, 0.17) / 0.9);
      h *= Math.min(0.9, shrink);
      if (Math.abs(h) < hmin) {
        if (info) info.stopped = 'singular';
        return { ts, ys, ok: false, yEnd: y, stiff };
      }
    }
  }
  ts.push(tEnd);
  ys.push(y.slice());
  return { ts, ys, ok: true, yEnd: y, stiff };
}
