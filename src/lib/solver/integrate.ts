import { rk4Step, isFiniteVec, maxAbs, type DerivFn } from './rk4';

/** Trajectory of a (possibly coupled) system as continuous segments of states. */
export interface TrajSegment {
  ts: number[];
  /** ys[i] is the full state vector at ts[i]. */
  ys: number[][];
}
export type Trajectory = TrajSegment[];

export interface IntegrateOpts {
  t0: number;
  y0: number[];
  tMin: number;
  tMax: number;
  /** Target number of steps across the visible span. */
  samples?: number;
  /** |state| above this ends a segment (asymptote / blow-up). */
  blowup?: number;
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
  const span = tMax - tMin;
  // Target resolution within the visible window.
  const hWindow = span > 0 ? span / samples : 0.01;
  // Cap steps per direction; if t0 is far from the window we use a coarser step so
  // the integration still reaches it (instead of stopping short and vanishing).
  const STEP_CAP = 8000;

  const marchTo = (tStop: number): TrajSegment => {
    const dist = Math.abs(tStop - t0);
    if (dist < 1e-15) return { ts: [t0], ys: [y0.slice()] };
    const steps = Math.min(STEP_CAP, Math.max(8, Math.ceil(dist / hWindow)));
    const h = (tStop - t0) / steps;
    const ts: number[] = [t0];
    const ys: number[][] = [y0.slice()];
    let t = t0;
    let y = y0.slice();
    for (let i = 0; i < steps; i++) {
      const next = rk4Step(deriv, t, y, h);
      t += h;
      if (!isFiniteVec(next) || maxAbs(next) > blowup) break;
      y = next;
      ts.push(t);
      ys.push(y.slice());
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
