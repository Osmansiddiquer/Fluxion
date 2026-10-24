import { describe, it, expect } from 'vitest';
import { runSteps, globalErrors, methodStep, STEP_ORDER, type StepMethod } from './methods';
import { shoot } from './shooting';
import type { DerivFn } from './rk4';
import { checkSpec } from '../api/check';

const oscillator: DerivFn = (_t, y) => [y[1], -y[0]];
const decay: DerivFn = (_t, y) => [-y[0]];

/** Global error at t = 2 for y′ = −y with step h. */
function errAt2(method: StepMethod, h: number): number {
  const n = Math.round(2 / h);
  let y = [1];
  for (let i = 0; i < n; i++) y = methodStep(method, decay, i * h, y, h);
  return Math.abs(y[0] - Math.exp(-2));
}

describe('one-step methods: measured convergence orders', () => {
  for (const m of ['euler', 'heun', 'rk4'] as const) {
    it(`${m} is order ${STEP_ORDER[m]}`, () => {
      const hs = [0.1, 0.05, 0.025, 0.0125];
      const errs = hs.map((h) => errAt2(m, h));
      for (let i = 1; i < hs.length; i++) {
        const p = Math.log2(errs[i - 1] / errs[i]);
        expect(p).toBeGreaterThan(STEP_ORDER[m] - 0.15);
        expect(p).toBeLessThan(STEP_ORDER[m] + 0.15);
      }
    });
  }
  it('the same holds on a system (harmonic oscillator) through runSteps + globalErrors', () => {
    for (const m of ['euler', 'heun', 'rk4'] as const) {
      const e = (h: number) => {
        const run = runSteps(oscillator, m, 0, [1, 0], h, 0, 3);
        const errs = globalErrors(oscillator, run, 0, [1, 0], 0);
        // Error at the step nearest t = 3.
        const i = run.ts.findIndex((t) => Math.abs(t - 3) < 1e-9);
        return errs[i];
      };
      const p = Math.log2(e(0.05) / e(0.025));
      expect(Math.abs(p - STEP_ORDER[m])).toBeLessThan(0.2);
    }
  });
});

describe('runSteps', () => {
  it('marches both ways from t0 with the given h, ascending', () => {
    const run = runSteps(decay, 'euler', 0, [1], 0.5, -2, 2);
    expect(run.ts).toEqual([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
    expect(run.ys[5][0]).toBeCloseTo(0.5, 12); // 1 + 0.5·(−1)
    expect(run.ys[3][0]).toBeCloseTo(1.5, 12); // backward Euler step of size −0.5
    expect(run.truncated).toBe(false);
  });
  it('caps the number of steps', () => {
    const run = runSteps(decay, 'rk4', 0, [1], 1e-3, 0, 100);
    expect(run.ts.length).toBe(2001);
    expect(run.truncated).toBe(true);
  });
  it('error at t0 is zero and grows with t', () => {
    const run = runSteps(oscillator, 'euler', 0, [1, 0], 0.25, 0, 4);
    const errs = globalErrors(oscillator, run, 0, [1, 0], 0);
    expect(errs[0]).toBe(0);
    expect(errs[errs.length - 1]).toBeGreaterThan(errs[2]);
  });
});

describe('shooting (BVP)', () => {
  it("y'' + y = 0, y(0) = 0, y(π/2) = 1 → sin t", () => {
    const r = shoot({ deriv: oscillator, a: 0, b: Math.PI / 2, ia: 0, alpha: 0, ib: 0, beta: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.y0[0]).toBe(0);
      expect(r.y0[1]).toBeCloseTo(1, 8);
    }
  });
  it("y'' + y = 0, y(0) = 0, y(π) = 0 is not unique (eigenvalue)", () => {
    const r = shoot({ deriv: oscillator, a: 0, b: Math.PI, ia: 0, alpha: 0, ib: 0, beta: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not unique/i);
  });
  it("y'' + y = 0, y(0) = 0, y(π) = 1 has no solution", () => {
    const r = shoot({ deriv: oscillator, a: 0, b: Math.PI, ia: 0, alpha: 0, ib: 0, beta: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no solution/i);
  });
  it("y'' = −λy on [0, π]: eigenvalues λ = n² are not unique, others give y ≡ 0", () => {
    for (const lam of [1, 4, 9]) {
      const f: DerivFn = (_t, y) => [y[1], -lam * y[0]];
      const r = shoot({ deriv: f, a: 0, b: Math.PI, ia: 0, alpha: 0, ib: 0, beta: 0 });
      expect(r.ok).toBe(false);
    }
    for (const lam of [2, 5.5]) {
      const f: DerivFn = (_t, y) => [y[1], -lam * y[0]];
      const r = shoot({ deriv: f, a: 0, b: Math.PI, ia: 0, alpha: 0, ib: 0, beta: 0 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(Math.abs(r.y0[1])).toBeLessThan(1e-8);
    }
  });
  it('a nonlinear BVP converges (y\'\' = −e^y, Bratu-like): residual at b is met', () => {
    const f: DerivFn = (_t, y) => [y[1], -Math.exp(y[0])];
    const r = shoot({ deriv: f, a: 0, b: 1, ia: 0, alpha: 0, ib: 0, beta: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.y0[1]).toBeCloseTo(0.5493, 3);
  });
  it('a derivative condition at b (y\'(b) = β) works', () => {
    // y'' = 0, y(0) = 1, y'(2) = 3 → y = 1 + 3t.
    const f: DerivFn = (_t, y) => [y[1], 0];
    const r = shoot({ deriv: f, a: 0, b: 2, ia: 0, alpha: 1, ib: 1, beta: 3 });
    expect(r.ok && r.y0[1]).toBeCloseTo(3, 9);
  });
  it('falls back to bracketing when the secant step blows up', () => {
    // y'' = y^3 blows up for large slopes; root near s ≈ 0.
    const f: DerivFn = (_t, y) => [y[1], y[0] ** 3];
    const r = shoot({ deriv: f, a: 0, b: 3, ia: 0, alpha: 0, ib: 0, beta: 0.5 });
    expect(r.ok).toBe(true);
  });
  it('rejects a = b', () => {
    const r = shoot({ deriv: oscillator, a: 1, b: 1, ia: 0, alpha: 0, ib: 0, beta: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('typed conditions that name an undefined slider (mid-typing)', () => {
  // Used to throw "Undefined symbol a" out of computeAll and take the app down.
  it.each([
    "y''=-y, y(0)=0, y(2)=a",
    "y''=-y, y(a)=0, y(2)=1",
    "y''=-y, y(0)=a, y'(0)=1",
    "y'=-y, y(a)=1",
  ])('%s: reports the undefined name instead of throwing', (expr) => {
    const r = checkSpec({ expressions: [expr] });
    expect(r.errors.map((e) => e.message).join()).toMatch(/undefined variable a/);
    expect(checkSpec({ expressions: ['a = 0.5', expr] }).errors).toEqual([]);
  });
});
