import type { DerivFn } from './rk4';
import { solveAt, type Impulse } from './integrate';

/**
 * Boundary-value problems for one 2nd-order equation by shooting: guess the
 * missing initial component s at t = a, integrate to t = b, and adjust s until
 * the condition at b holds. Secant iteration first; if it fails, scan for a sign
 * change of the residual and refine it with the Illinois (regula falsi) method.
 *
 * Conditions: component `ia` (0 = y, 1 = y′) equals `alpha` at a, and component
 * `ib` equals `beta` at b. The unknown is the other component at a.
 */
export interface BvpProblem {
  deriv: DerivFn;
  a: number;
  b: number;
  ia: 0 | 1;
  alpha: number;
  ib: 0 | 1;
  beta: number;
  impulses?: Impulse[];
  breaks?: number[];
}

export type BvpResult =
  | { ok: true; /** Initial state [y(a), y′(a)]. */ y0: number[]; iterations: number }
  | { ok: false; error: string };

const MAX_SECANT = 40;

export function shoot(p: BvpProblem): BvpResult {
  if (!(Number.isFinite(p.a) && Number.isFinite(p.b))) return { ok: false, error: 'Boundary points must be numbers' };
  if (Math.abs(p.b - p.a) < 1e-12) return { ok: false, error: 'The two boundary points must differ' };
  const iu = p.ia === 0 ? 1 : 0;
  const state = (s: number) => {
    const y = [0, 0];
    y[p.ia] = p.alpha;
    y[iu] = s;
    return y;
  };
  let evals = 0;
  const residual = (s: number): number => {
    evals++;
    const [yb] = solveAt(p.deriv, p.a, state(s), [p.b], {
      impulses: p.impulses,
      breaks: p.breaks,
      rtol: 1e-11,
      atol: 1e-13,
      blowup: 1e12,
    });
    const r = yb[p.ib] - p.beta;
    return Number.isFinite(r) ? r : NaN;
  };

  const scale = 1 + Math.abs(p.alpha) + Math.abs(p.beta);
  const tol = 1e-9 * scale;
  // First guesses: the straight line through the two values (for y(a), y(b)).
  const L = p.b - p.a;
  const g0 = p.ia === 0 && p.ib === 0 ? (p.beta - p.alpha) / L : 0;
  let s0 = g0;
  let s1 = g0 + 1;
  let r0 = residual(s0);
  let r1 = residual(s1);

  // Degenerate (the residual doesn't depend on s): no solution or infinitely many.
  if (Number.isFinite(r0) && Number.isFinite(r1)) {
    const r2 = residual(g0 - 7.3);
    const flat = (u: number, v: number) => Math.abs(u - v) <= 1e-7 * (scale + Math.abs(u) + Math.abs(v));
    if (Number.isFinite(r2) && flat(r0, r1) && flat(r0, r2)) {
      return Math.abs(r0) <= 1e-6 * scale
        ? { ok: false, error: 'Not unique: every slope fits these boundary values (an eigenvalue case)' }
        : { ok: false, error: 'No solution: no initial slope reaches the boundary value at b' };
    }
  }

  // Secant iteration.
  for (let it = 0; it < MAX_SECANT && Number.isFinite(r0) && Number.isFinite(r1); it++) {
    if (Math.abs(r1) <= tol) return finish(s1, it + 1);
    const d = r1 - r0;
    if (d === 0) break;
    const s2 = s1 - (r1 * (s1 - s0)) / d;
    if (!Number.isFinite(s2) || Math.abs(s2) > 1e9) break;
    s0 = s1;
    r0 = r1;
    s1 = s2;
    r1 = residual(s1);
    if (Math.abs(s1 - s0) <= 1e-14 * (1 + Math.abs(s1)) && Math.abs(r1) <= 1e3 * tol) return finish(s1, it + 1);
  }

  // Bracketing fallback: scan widening ranges of s for a sign change.
  for (const R of [1, 10, 100, 1000]) {
    const N = 40;
    let prevS = NaN;
    let prevR = NaN;
    for (let i = 0; i <= N; i++) {
      const s = g0 - R + (2 * R * i) / N;
      const r = residual(s);
      if (Number.isFinite(r) && Math.abs(r) <= tol) return finish(s, evals);
      if (Number.isFinite(r) && Number.isFinite(prevR) && Math.sign(r) !== Math.sign(prevR)) {
        const root = illinois(residual, prevS, prevR, s, r, tol);
        if (root !== null) return finish(root, evals);
      }
      prevS = s;
      prevR = r;
    }
  }
  return {
    ok: false,
    error: 'No solution found: no initial slope hits the boundary value (the problem may be too sensitive)',
  };

  function finish(s: number, iterations: number): BvpResult {
    // Sensitivity: the residual changes enormously for a tiny change in s, so
    // the computed solution can't be trusted.
    const ds = 1e-6 * (1 + Math.abs(s));
    const rp = residual(s + ds);
    const slope = Math.abs((rp - residual(s)) / ds);
    if (!Number.isFinite(slope) || slope > 1e10 * scale) {
      return { ok: false, error: 'Too sensitive: tiny changes in the initial slope swing y(b) wildly; try a shorter interval' };
    }
    return { ok: true, y0: state(s), iterations };
  }
}

function illinois(
  g: (s: number) => number,
  a: number,
  fa: number,
  b: number,
  fb: number,
  tol: number,
): number | null {
  let side = 0;
  for (let i = 0; i < 100; i++) {
    const c = (a * fb - b * fa) / (fb - fa);
    const fc = g(c);
    if (!Number.isFinite(fc)) return null;
    if (Math.abs(fc) <= tol || Math.abs(b - a) <= 1e-14 * (1 + Math.abs(c))) return c;
    if (Math.sign(fc) === Math.sign(fb)) {
      b = c;
      fb = fc;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = c;
      fa = fc;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return null;
}
