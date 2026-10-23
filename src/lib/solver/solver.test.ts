import { describe, it, expect } from 'vitest';
import { integrateSystem, solveAt, type SolverMethod, type IntegrateInfo } from './integrate';
import { newInfo } from './adaptive';
import { dopriStep } from './dopri5';
import { rosenbrockStep } from './stiff';
import type { DerivFn } from './rk4';

const decay: DerivFn = (_t, y) => [-y[0]];
const oscillator: DerivFn = (_t, y) => [y[1], -y[0]];
const logistic: DerivFn = (_t, y) => [y[0] * (1 - y[0])];
const logisticExact = (t: number) => 0.1 / (0.1 + 0.9 * Math.exp(-t));

function maxErr(method: SolverMethod, f: DerivFn, y0: number[], exact: (t: number) => number, info?: IntegrateInfo) {
  const traj = integrateSystem(f, { t0: 0, y0, tMin: -8, tMax: 8, samples: 1500, method, info });
  expect(traj.length).toBe(1);
  let e = 0;
  for (let i = 0; i < traj[0].ts.length; i++) e = Math.max(e, Math.abs(traj[0].ys[i][0] - exact(traj[0].ts[i])));
  return { err: e, traj: traj[0] };
}

describe('adaptive solver accuracy (exact solutions)', () => {
  it('exponential decay', () => {
    for (const m of ['auto', 'rk45', 'rk4'] as const) {
      const { err } = maxErr(m, decay, [1], (t) => Math.exp(-t));
      // Relative to e^8 ≈ 2981 at the left edge.
      expect(err / Math.exp(8)).toBeLessThan(1e-8);
    }
  });
  it('harmonic oscillator', () => {
    for (const m of ['auto', 'rk45', 'rk4'] as const) {
      const { err } = maxErr(m, oscillator, [1, 0], Math.cos);
      expect(err).toBeLessThan(1e-8);
    }
  });
  it('logistic growth', () => {
    for (const m of ['auto', 'rk45', 'rk4'] as const) {
      const { err } = maxErr(m, logistic, [0.1], logisticExact);
      expect(err).toBeLessThan(1e-8);
    }
  });
  it('the adaptive method needs far fewer evaluations than RK4 on smooth problems', () => {
    const a = newInfo();
    const r = newInfo();
    maxErr('auto', oscillator, [1, 0], Math.cos, a);
    maxErr('rk4', oscillator, [1, 0], Math.cos, r);
    expect(a.fevals).toBeLessThan(r.fevals * 0.8);
    expect(a.stiff).toBe(false);
  });
  it('Euler is first order and visibly inaccurate at the default step', () => {
    const { err } = maxErr('euler', oscillator, [1, 0], Math.cos);
    expect(err).toBeGreaterThan(1e-3);
    expect(err).toBeLessThan(0.2);
  });
});

describe('error tolerance behaviour', () => {
  it('a tighter tolerance gives a smaller error with more steps', () => {
    const errs: number[] = [];
    const steps: number[] = [];
    for (const rtol of [1e-4, 1e-7, 1e-10]) {
      const info = newInfo();
      const [y] = solveAt(oscillator, 0, [1, 0], [20], { rtol, atol: rtol * 1e-2, method: 'rk45' });
      integrateSystem(oscillator, { t0: 0, y0: [1, 0], tMin: 0, tMax: 20, method: 'rk45', rtol, atol: rtol * 1e-2, info });
      errs.push(Math.abs(y[0] - Math.cos(20)));
      steps.push(info.steps);
    }
    expect(errs[1]).toBeLessThan(errs[0]);
    expect(errs[2]).toBeLessThan(errs[1]);
    expect(steps[1]).toBeGreaterThan(steps[0]);
    expect(steps[2]).toBeGreaterThan(steps[1]);
    // Error roughly tracks the tolerance (within a few orders).
    expect(errs[0]).toBeLessThan(1e-2);
    expect(errs[2]).toBeLessThan(1e-7);
  });
  it('DOPRI5 local error estimate shrinks like h^5', () => {
    const f0 = oscillator(0, [1, 0]);
    const e1 = dopriStep(oscillator, 0, [1, 0], f0, 0.4, 0, 1).err;
    const e2 = dopriStep(oscillator, 0, [1, 0], f0, 0.2, 0, 1).err;
    expect(Math.log2(e1 / e2)).toBeGreaterThan(4.5);
  });
});

describe('dense output', () => {
  it('is continuous and accurate between steps', () => {
    const f0 = oscillator(0, [1, 0]);
    const h = 0.5;
    const s = dopriStep(oscillator, 0, [1, 0], f0, h, 1e-9, 1e-12);
    expect(s.dense(0)[0]).toBeCloseTo(1, 14);
    expect(s.dense(1)[0]).toBeCloseTo(s.y[0], 14);
    for (let th = 0; th <= 1; th += 0.05) {
      expect(Math.abs(s.dense(th)[0] - Math.cos(th * h))).toBeLessThan(1e-5);
    }
  });
  it('samples the window evenly whatever the step size', () => {
    const info = newInfo();
    const traj = integrateSystem(oscillator, { t0: 0, y0: [1, 0], tMin: -8, tMax: 8, samples: 1500, method: 'rk45', info });
    const ts = traj[0].ts;
    expect(info.steps).toBeLessThan(ts.length / 2);
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      expect(d).toBeGreaterThan(0.0106);
      expect(d).toBeLessThan(0.0107);
    }
    // Neighbouring samples never jump (no kinks between steps).
    for (let i = 1; i < ts.length; i++) {
      expect(Math.abs(traj[0].ys[i][0] - traj[0].ys[i - 1][0])).toBeLessThan(0.011);
    }
  });
  it('Rosenbrock dense output meets both step ends', () => {
    const f0 = oscillator(0, [1, 0]);
    const s = rosenbrockStep(oscillator, 0, [1, 0], f0, 0.1, 1e-6, 1e-9)!;
    expect(s.dense(0)[0]).toBeCloseTo(1, 14);
    expect(s.dense(1)[0]).toBeCloseTo(s.y[0], 14);
  });
});

describe('stiff problems', () => {
  // Van der Pol, μ = 1000 (classic stiff test): one relaxation period ≈ 1614.
  const mu = 1000;
  const vdp: DerivFn = (_t, y) => [y[1], mu * (1 - y[0] * y[0]) * y[1] - y[0]];
  it('auto detects stiffness and finishes Van der Pol μ=1000 quickly', () => {
    const info = newInfo();
    const t = performance.now();
    const traj = integrateSystem(vdp, { t0: 0, y0: [2, 0], tMin: 0, tMax: 3000, samples: 1500, method: 'auto', info });
    const ms = performance.now() - t;
    expect(info.stiff).toBe(true);
    expect(info.stopped).toBeUndefined();
    expect(ms).toBeLessThan(1500);
    const seg = traj[0];
    expect(seg.ts[seg.ts.length - 1]).toBe(3000);
    // The slow branch: y decays from 2 towards ~1 and then jumps to ≈ −2 near t ≈ 807.
    const at = (tq: number) => seg.ys[seg.ts.findIndex((x) => x >= tq)][0];
    expect(at(400)).toBeGreaterThan(1);
    expect(at(400)).toBeLessThan(2);
    expect(at(900)).toBeLessThan(-1);
    // Agreement with a tight reference.
    const [ref] = solveAt(vdp, 0, [2, 0], [400], { rtol: 1e-8, atol: 1e-10 });
    expect(Math.abs(at(400) - ref[0])).toBeLessThan(5e-3);
  });
  it('Robertson chemical kinetics stays accurate and conserves mass', () => {
    const rob: DerivFn = (_t, y) => [
      -0.04 * y[0] + 1e4 * y[1] * y[2],
      0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1],
      3e7 * y[1] * y[1],
    ];
    const info = newInfo();
    const t = performance.now();
    const [y] = solveAt(rob, 0, [1, 0, 0], [40], { rtol: 1e-6, atol: 1e-10 });
    const traj = integrateSystem(rob, { t0: 0, y0: [1, 0, 0], tMin: 0, tMax: 40, method: 'auto', rtol: 1e-6, atol: 1e-10, info });
    expect(performance.now() - t).toBeLessThan(1500);
    expect(info.stiff).toBe(true);
    // Reference values (Hairer & Wanner) at t = 40.
    expect(y[0]).toBeCloseTo(0.7158, 3);
    expect(y[2]).toBeCloseTo(0.2842, 3);
    const end = traj[0].ys[traj[0].ys.length - 1];
    expect(Math.abs(end[0] + end[1] + end[2] - 1)).toBeLessThan(1e-6);
  });
});

describe('blow-up handling', () => {
  it('stops at a finite-time blow-up (y′ = y², y(0) = 1 blows up at t = 1)', () => {
    for (const m of ['auto', 'rk45', 'rk4'] as const) {
      const traj = integrateSystem((_t, y) => [y[0] * y[0]], { t0: 0, y0: [1], tMin: -2, tMax: 4, method: m });
      const ts = traj[0].ts;
      const last = ts[ts.length - 1];
      // (Fixed-step RK4 may take one finite step across the pole, as before.)
      expect(last).toBeLessThan(m === 'rk4' ? 1.01 : 1);
      expect(last).toBeGreaterThan(0.99);
      expect(ts[0]).toBeCloseTo(-2, 9);
    }
  });
});
