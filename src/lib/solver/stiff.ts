import type { DerivFn } from './rk4';
import { rmsNorm, type StepAttempt } from './dopri5';

/**
 * Linearly implicit Rosenbrock method for stiff systems: the L-stable
 * second-order pair of Shampine & Reichelt (MATLAB's ode23s), with an embedded
 * third-order error estimate and a free continuous extension. The Jacobian is
 * taken by finite differences, so any right-hand side works.
 */

const D = 1 / (2 + Math.SQRT2);
const E32 = 6 + Math.SQRT2;

/** Finite-difference Jacobian ∂f/∂y (row-major n×n) and ∂f/∂t at (t, y). */
export function numericJacobian(
  f: DerivFn,
  t: number,
  y: number[],
  f0: number[],
): { J: number[][]; ft: number[] } {
  const n = y.length;
  const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const yp = y.slice();
  for (let j = 0; j < n; j++) {
    const del = 1.5e-8 * Math.max(Math.abs(y[j]), 1e-5);
    yp[j] = y[j] + del;
    const fj = f(t, yp);
    yp[j] = y[j];
    const step = (y[j] + del) - y[j];
    for (let i = 0; i < n; i++) J[i][j] = (fj[i] - f0[i]) / step;
  }
  const dt = 1.5e-8 * Math.max(Math.abs(t), 1e-5);
  const ftv = f(t + dt, y);
  const ft = new Array<number>(n);
  for (let i = 0; i < n; i++) ft[i] = (ftv[i] - f0[i]) / dt;
  return { J, ft };
}

/** LU factorisation with partial pivoting; null when singular. */
export function luFactor(A: number[][]): { LU: number[][]; piv: number[] } | null {
  const n = A.length;
  const LU = A.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(LU[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(LU[i][k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (!(best > 0) || !Number.isFinite(best)) return null;
    if (p !== k) {
      [LU[p], LU[k]] = [LU[k], LU[p]];
      [piv[p], piv[k]] = [piv[k], piv[p]];
    }
    for (let i = k + 1; i < n; i++) {
      const m = LU[i][k] / LU[k][k];
      LU[i][k] = m;
      for (let j = k + 1; j < n; j++) LU[i][j] -= m * LU[k][j];
    }
  }
  return { LU, piv };
}

export function luSolve(lu: { LU: number[][]; piv: number[] }, b: number[]): number[] {
  const { LU, piv } = lu;
  const n = LU.length;
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[piv[i]];
    for (let j = 0; j < i; j++) s -= LU[i][j] * x[j];
    x[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= LU[i][j] * x[j];
    x[i] = s / LU[i][i];
  }
  return x;
}

/**
 * One Rosenbrock (ode23s) step from (t, y), f0 = f(t, y). The error is the
 * weighted RMS of the embedded estimate (≤ 1 → accept). Returns null when the
 * iteration matrix is singular (the caller shrinks h).
 */
export function rosenbrockStep(
  f: DerivFn,
  t: number,
  y: number[],
  f0: number[],
  h: number,
  rtol: number,
  atol: number,
): StepAttempt | null {
  const n = y.length;
  const { J, ft } = numericJacobian(f, t, y, f0);
  const W: number[][] = J.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - h * D * v));
  const lu = luFactor(W);
  if (!lu) return null;

  const rhs1 = new Array<number>(n);
  for (let i = 0; i < n; i++) rhs1[i] = f0[i] + h * D * ft[i];
  const k1 = luSolve(lu, rhs1);

  const yh = new Array<number>(n);
  for (let i = 0; i < n; i++) yh[i] = y[i] + 0.5 * h * k1[i];
  const F1 = f(t + 0.5 * h, yh);
  const rhs2 = new Array<number>(n);
  for (let i = 0; i < n; i++) rhs2[i] = F1[i] - k1[i];
  const k2 = luSolve(lu, rhs2);
  for (let i = 0; i < n; i++) k2[i] += k1[i];

  const ynew = new Array<number>(n);
  for (let i = 0; i < n; i++) ynew[i] = y[i] + h * k2[i];
  const F2 = f(t + h, ynew);
  const rhs3 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    rhs3[i] = F2[i] - E32 * (k2[i] - F1[i]) - 2 * (k1[i] - f0[i]) + h * D * ft[i];
  }
  const k3 = luSolve(lu, rhs3);

  const errv = new Array<number>(n);
  const sc = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    errv[i] = (h / 6) * (k1[i] - 2 * k2[i] + k3[i]);
    sc[i] = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
  }
  const err = rmsNorm(errv, sc);

  const dense = (theta: number): number[] => {
    const a = (theta * (1 - theta)) / (1 - 2 * D);
    const b = (theta * (theta - 2 * D)) / (1 - 2 * D);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = y[i] + h * (a * k1[i] + b * k2[i]);
    return out;
  };

  return { err, y: ynew, f: F2, hLambda: NaN, dense };
}
