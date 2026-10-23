import { describe, expect, it } from 'vitest';
import { computeAll, type CurveResult } from './compute';
import { computeSignature } from '../state/signature';
import type { Entry, Viewport } from '../store/types';

const VP: Viewport = { tMin: -2, tMax: 6, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: extra.id ?? `o${n++}`,
  raw,
  color: '#000000',
  visible: true,
  expanded: false,
  ...extra,
});
const run = (entries: Entry[], vp = VP) => computeAll(entries, vp, 800);

/** Max |y − exact(t)| over the curve, on t ∈ [lo, hi] (skipping points within `gap` of `skip`). */
function maxErr(r: CurveResult, exact: (t: number) => number, lo = -Infinity, hi = Infinity, skip?: number, gap = 1e-9) {
  let e = 0;
  let count = 0;
  for (const seg of r.curve.segments) {
    for (const [t, y] of seg) {
      if (t < lo || t > hi) continue;
      if (skip !== undefined && Math.abs(t - skip) < gap) continue;
      e = Math.max(e, Math.abs(y - exact(t)));
      count++;
    }
  }
  expect(count).toBeGreaterThan(10);
  return e;
}

describe('x as the independent variable of an ODE', () => {
  it('dy/dx = x + y with y(0) = 0 is e^x − x − 1', () => {
    const e = E('dy/dx = x + y', { ic: [0] });
    const r = run([e]).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(r.undefinedVars ?? []).toEqual([]);
    expect(maxErr(r, (t) => Math.exp(t) - t - 1, -2, 2)).toBeLessThan(1e-7);
  });
  it("prime notation y' = x·y alone also reads x as the variable", () => {
    const e = E("y' = x*y");
    const r = run([e]).get(e.id)!;
    expect(r.undefinedVars ?? []).toEqual([]);
    expect(maxErr(r, (t) => Math.exp((t * t) / 2), -2, 2)).toBeLessThan(1e-6);
  });
  it('…but x stays a dependent variable when a system defines it', () => {
    const ex = E("x' = -y", { ic: [1] });
    const ey = E("y' = x", { ic: [0] });
    const res = run([ex, ey]);
    expect(maxErr(res.get(ex.id)!, Math.cos)).toBeLessThan(1e-7);
    expect(maxErr(res.get(ey.id)!, Math.sin)).toBeLessThan(1e-7);
  });
  it('…and a row with t keeps t as the variable (x is then a slider to define)', () => {
    const e = E("y' = x*t");
    expect(run([e]).get(e.id)!.undefinedVars).toEqual(['x']);
  });
});

describe('typed conditions', () => {
  it("inline: y'' = -y, y(0) = 0, y'(0) = 1 is sin t (overrides the sliders)", () => {
    const e = E("y'' = -y, y(0) = 0, y'(0) = 1", { ic: [5, 5] });
    const r = run([e]).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(maxErr(r, Math.sin)).toBeLessThan(1e-7);
    expect(r.numerics?.typedIc).toEqual([true, true]);
    expect(r.numerics?.typedT0).toBe(true);
  });
  it('on their own rows, with sliders, at any t', () => {
    const ea = E('a = 2');
    const e = E("y' = -y");
    const c = E('y(1) = a');
    const r = run([ea, e, c]).get(e.id)!;
    expect(maxErr(r, (t) => 2 * Math.exp(-(t - 1)))).toBeLessThan(1e-6);
    expect(r.numerics?.t0).toBe(1);
    // Changing the slider re-solves (the condition value is in the cache key).
    const r2 = run([{ ...ea, varValue: 3 }, e, c]).get(e.id)!;
    expect(maxErr(r2, (t) => 3 * Math.exp(-(t - 1)))).toBeLessThan(1e-6);
  });
  it('a partial set keeps the slider value for the rest', () => {
    const e = E("y'' = -y", { ic: [0, 2] });
    const c = E('y(0) = 1');
    const r = run([e, c]).get(e.id)!;
    expect(maxErr(r, (t) => Math.cos(t) + 2 * Math.sin(t))).toBeLessThan(1e-6);
    expect(r.numerics?.typedIc).toEqual([true, false]);
  });
  it('hidden condition rows are ignored', () => {
    const e = E("y' = -y", { ic: [1] });
    const c = E('y(0) = 4', { visible: false });
    expect(maxErr(run([e, c]).get(e.id)!, (t) => Math.exp(-t))).toBeLessThan(1e-6);
  });
  it('reports bad conditions on the ODE row', () => {
    const cases: [string[], RegExp][] = [
      [["y' = -y", 'y(0) = 1, y(0) = 2'], /given twice/],
      [["y' = -y", "y'(0) = 1"], /conditions go up to y/],
      [["y'' = -y", 'y(0) = 1', 'y(1) = 2', 'y(2) = 3'], /takes 2 conditions/],
    ];
    for (const [rows, re] of cases) {
      const es = rows.map((r) => E(r));
      const res = run(es);
      expect(res.get(es[0].id)!.error).toMatch(re);
    }
  });
  it('a condition without an equation says so', () => {
    const c = E('z(0) = 1');
    expect(run([c]).get(c.id)!.error).toMatch(/No equation for z/);
  });
});

describe('step and impulse forcing', () => {
  it("y' = −y + H(t − 1), y(0) = 0: 0 until t = 1, then 1 − e^{−(t−1)}", () => {
    for (const fn of ['H', 'u', 'heaviside']) {
      const e = E(`y' = -y + ${fn}(t - 1)`, { ic: [0] });
      const r = run([e]).get(e.id)!;
      expect(r.error).toBeUndefined();
      const exact = (t: number) => (t >= 1 ? 1 - Math.exp(-(t - 1)) : 0);
      expect(maxErr(r, exact, 0, 6)).toBeLessThan(1e-7);
    }
  });
  it("y'' + y = δ(t − 1), y(0) = y'(0) = 0 is sin(t − 1)·H(t − 1)", () => {
    const e = E("y'' + y = delta(t - 1)", { ic: [0, 0] });
    const r = run([e]).get(e.id)!;
    expect(r.error).toBeUndefined();
    const exact = (t: number) => (t >= 1 ? Math.sin(t - 1) : 0);
    expect(maxErr(r, exact, -2, 6)).toBeLessThan(1e-7);
    // y itself is continuous: one piece.
    expect(r.curve.segments).toHaveLength(1);
    expect(r.numerics?.impulses).toEqual([1]);
  });
  it("first order: y' = −y + 2δ(t − 1) jumps by 2 at t = 1 (the curve breaks there)", () => {
    const e = E("y' = -y + 2 delta(t - 1)", { ic: [1] });
    const r = run([e]).get(e.id)!;
    expect(r.curve.segments).toHaveLength(2);
    const exact = (t: number) => Math.exp(-t) + (t > 1 ? 2 * Math.exp(-(t - 1)) : 0);
    const [left, right] = r.curve.segments;
    expect(left[left.length - 1][0]).toBe(1);
    expect(left[left.length - 1][1]).toBeCloseTo(Math.exp(-1), 7);
    expect(right[0][0]).toBe(1);
    expect(right[0][1]).toBeCloseTo(Math.exp(-1) + 2, 7);
    expect(maxErr(r, exact, -2, 6, 1)).toBeLessThan(1e-6);
  });
  it('impulse strength and position follow sliders; δ(2(t − 1)) has weight ½', () => {
    const k = E('k = 3');
    const e = E("y'' + y = k delta(2(t - 1))", { ic: [0, 0] });
    const r = run([k, e]).get(e.id)!;
    expect(maxErr(r, (t) => (t >= 1 ? 1.5 * Math.sin(t - 1) : 0))).toBeLessThan(1e-6);
  });
  it('the impulse acts the same for every solver (split steps)', () => {
    for (const solver of ['auto', 'rk45', 'rk4'] as const) {
      const e = E("y'' + y = delta(t - 1)", { ic: [0, 0], solver });
      const r = run([e]).get(e.id)!;
      expect(maxErr(r, (t) => (t >= 1 ? Math.sin(t - 1) : 0))).toBeLessThan(1e-6);
    }
  });
});

describe('boundary-value problems', () => {
  it("typed: y'' = −y, y(0) = 0, y(π/2) = 1 is sin t", () => {
    const e = E("y'' = -y");
    const c = E('y(0) = 0, y(pi/2) = 1');
    const r = run([e, c]).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(maxErr(r, Math.sin)).toBeLessThan(1e-6);
    expect(r.numerics?.bvp).toMatchObject({ a: 0, b: Math.PI / 2, typed: true });
  });
  it('inline on the ODE row', () => {
    const e = E("y'' = -y, y(0) = 0, y(pi/2) = 1");
    expect(maxErr(run([e]).get(e.id)!, Math.sin)).toBeLessThan(1e-6);
  });
  it('from the Conditions switch: bc = [a, α, b, β]', () => {
    const e = E("y'' = -y", { conditions: 'boundary', bc: [0, 0, Math.PI / 2, 2] });
    expect(maxErr(run([e]).get(e.id)!, (t) => 2 * Math.sin(t))).toBeLessThan(1e-6);
  });
  it('eigenvalue cases: y\'\' = −λy, y(0) = y(π) = 0', () => {
    const lam = E('lambda = 4');
    const e = E("y'' = -lambda*y, y(0) = 0, y(pi) = 0");
    expect(run([lam, e]).get(e.id)!.error).toMatch(/not unique/i);
    const r = run([{ ...lam, varValue: 3 }, e]).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(maxErr(r, () => 0)).toBeLessThan(1e-8);
  });
  it('no solution', () => {
    const e = E("y'' = -y, y(0) = 0, y(pi) = 1");
    expect(run([e]).get(e.id)!.error).toMatch(/no solution/i);
  });
  it('a system cannot be a boundary problem', () => {
    const ex = E("x'' = -y", { conditions: 'boundary' });
    const ey = E("y'' = -x");
    expect(run([ex, ey]).get(ex.id)!.error).toMatch(/single 2nd-order/);
  });
});

describe('numerics options and the caches', () => {
  it('solver choice changes the result (and re-solves), colour does not', () => {
    const base = E("y' = cos(3t)*y", { id: 'cache-a' });
    const r1 = run([base]).get(base.id)!;
    const r2 = run([{ ...base, color: '#ff0000' }]).get(base.id)!;
    expect(r2.curve).toBe(r1.curve);
    const r3 = run([{ ...base, solver: 'euler' }]).get(base.id)!;
    expect(r3.curve).not.toBe(r1.curve);
    expect(r3.numerics?.solver).toBe('euler');
    const r4 = run([{ ...base, solver: 'euler', steps: 'heun' }]).get(base.id)!;
    expect(r4.numerics?.steps?.method).toBe('heun');
    const r5 = run([{ ...base, solver: 'euler', steps: 'heun', stepSize: 0.25 }]).get(base.id)!;
    expect(r5.numerics?.steps?.h).toBe(0.25);
    expect(r5.numerics?.steps!.ts.length).toBeGreaterThan(r4.numerics!.steps!.ts.length);
  });
  it('computeSignature covers the numerics fields, not cosmetic ones', () => {
    const e = E("y' = y", { id: 'sig' });
    const s = computeSignature([e]);
    expect(computeSignature([{ ...e, color: '#123456', expanded: true }])).toBe(s);
    for (const patch of [
      { solver: 'rk45' as const },
      { steps: 'euler' as const },
      { stepSize: 0.1 },
      { conditions: 'boundary' as const },
      { bc: [0, 1, 2, 3] },
    ]) {
      expect(computeSignature([{ ...e, ...patch }])).not.toBe(s);
    }
  });
  it('shown steps carry the global error, zero at t0', () => {
    const e = E("y' = y", { ic: [1], steps: 'euler', stepSize: 0.5 });
    const st = run([e]).get(e.id)!.numerics!.steps!;
    const i0 = st.ts.indexOf(0);
    expect(st.err[i0]).toBe(0);
    const i2 = st.ts.findIndex((t) => Math.abs(t - 2) < 1e-12);
    expect(st.ys[i2]).toBeCloseTo(1.5 ** 4, 10);
    expect(st.err[i2]).toBeCloseTo(Math.exp(2) - 1.5 ** 4, 6);
  });
});
