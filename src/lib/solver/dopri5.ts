import type { DerivFn } from './rk4';

/**
 * Dormand–Prince 5(4) (DOPRI5, Hairer–Nørsett–Wanner): an explicit Runge–Kutta
 * pair with error control, PI step-size control, FSAL, a 4th-order continuous
 * extension ("dense output") and Hairer's stiffness test. One call advances one
 * step; the caller owns the loop (see adaptive.ts) so DOPRI5 and the Rosenbrock
 * fallback can share it.
 */

const C2 = 1 / 5;
const C3 = 3 / 10;
const C4 = 4 / 5;
const C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40;
const A32 = 9 / 40;
const A41 = 44 / 45;
const A42 = -56 / 15;
const A43 = 32 / 9;
const A51 = 19372 / 6561;
const A52 = -25360 / 2187;
const A53 = 64448 / 6561;
const A54 = -212 / 729;
const A61 = 9017 / 3168;
const A62 = -355 / 33;
const A63 = 46732 / 5247;
const A64 = 49 / 176;
const A65 = -5103 / 18656;
const A71 = 35 / 384;
const A73 = 500 / 1113;
const A74 = 125 / 192;
const A75 = -2187 / 6784;
const A76 = 11 / 84;
const E1 = 71 / 57600;
const E3 = -71 / 16695;
const E4 = 71 / 1920;
const E5 = -17253 / 339200;
const E6 = 22 / 525;
const E7 = -1 / 40;
const D1 = -12715105075 / 11282082432;
const D3 = 87487479700 / 32700410799;
const D4 = -10690763975 / 1880347072;
const D5 = 701980252875 / 199316789632;
const D6 = -1453857185 / 822651844;
const D7 = 69997945 / 29380423;

/** Result of one attempted step. */
export interface StepAttempt {
  /** Scaled RMS error estimate (≤ 1 → accept). */
  err: number;
  /** Proposed state at t + h. */
  y: number[];
  /** f(t + h, y) (FSAL: the next step's first stage). */
  f: number[];
  /** h·|λ| estimate for the stiffness test (NaN when unavailable). */
  hLambda: number;
  /** Dense output on [t, t + h]: state at t + θh, θ ∈ [0, 1]. */
  dense: (theta: number) => number[];
}

/** Weighted RMS norm of v with tolerance scale sc. */
export function rmsNorm(v: number[], sc: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const q = v[i] / sc[i];
    s += q * q;
  }
  return Math.sqrt(s / Math.max(1, v.length));
}

/** One DOPRI5 step from (t, y) with derivative f0 = f(t, y). */
export function dopriStep(
  f: DerivFn,
  t: number,
  y: number[],
  f0: number[],
  h: number,
  rtol: number,
  atol: number,
): StepAttempt {
  const n = y.length;
  const k1 = f0;
  // Fresh stage vectors (a right-hand side may keep a reference to its argument).
  const s2 = new Array<number>(n);
  for (let i = 0; i < n; i++) s2[i] = y[i] + h * A21 * k1[i];
  const k2 = f(t + C2 * h, s2);
  const s3 = new Array<number>(n);
  for (let i = 0; i < n; i++) s3[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
  const k3 = f(t + C3 * h, s3);
  const s4 = new Array<number>(n);
  for (let i = 0; i < n; i++) s4[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
  const k4 = f(t + C4 * h, s4);
  const s5 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    s5[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
  }
  const k5 = f(t + C5 * h, s5);
  const ysti = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    ysti[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
  }
  const k6 = f(t + h, ysti);
  const y1 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y1[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
  }
  const k7 = f(t + h, y1);

  const errv = new Array<number>(n);
  const sc = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    errv[i] = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
    sc[i] = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y1[i]));
  }
  const err = rmsNorm(errv, sc);

  // Hairer's stiffness indicator: h·|λ| ≈ h‖k7 − k6‖ / ‖y1 − ysti‖.
  let stnum = 0;
  let stden = 0;
  for (let i = 0; i < n; i++) {
    stnum += (k7[i] - k6[i]) ** 2;
    stden += (y1[i] - ysti[i]) ** 2;
  }
  const hLambda = stden > 0 ? Math.abs(h) * Math.sqrt(stnum / stden) : NaN;

  const dense = (theta: number): number[] => {
    const th1 = 1 - theta;
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const ydiff = y1[i] - y[i];
      const bspl = h * k1[i] - ydiff;
      const r4 = ydiff - h * k7[i] - bspl;
      const r5 = h * (D1 * k1[i] + D3 * k3[i] + D4 * k4[i] + D5 * k5[i] + D6 * k6[i] + D7 * k7[i]);
      out[i] = y[i] + theta * (ydiff + th1 * (bspl + theta * (r4 + th1 * r5)));
    }
    return out;
  };

  return { err, y: y1, f: k7, hLambda, dense };
}

/** Hairer's starting step size for an order-`order` method. */
export function initialStep(
  f: DerivFn,
  t: number,
  y: number[],
  f0: number[],
  dir: number,
  hmax: number,
  rtol: number,
  atol: number,
  order: number,
): number {
  const n = y.length;
  const sc = y.map((v) => atol + rtol * Math.abs(v));
  const d0 = rmsNorm(y, sc);
  const d1 = rmsNorm(f0, sc);
  let h0 = d0 < 1e-10 || d1 < 1e-10 ? 1e-6 : 0.01 * (d0 / d1);
  h0 = Math.min(h0, hmax);
  const y1 = new Array<number>(n);
  for (let i = 0; i < n; i++) y1[i] = y[i] + dir * h0 * f0[i];
  const f1 = f(t + dir * h0, y1);
  const df = new Array<number>(n);
  for (let i = 0; i < n; i++) df[i] = f1[i] - f0[i];
  const d2 = rmsNorm(df, sc) / h0;
  const m = Math.max(d1, d2);
  const h1 = m <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : Math.pow(0.01 / m, 1 / (order + 1));
  const h = Math.min(100 * h0, h1, hmax);
  return Number.isFinite(h) && h > 0 ? h : Math.min(1e-3, hmax);
}
