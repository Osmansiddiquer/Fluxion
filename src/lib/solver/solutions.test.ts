import { describe, expect, it } from 'vitest';
import { callsOf, computeAll, type CurveResult } from '../compute';
import { entryToLatex } from '../math/tolatex';
import { latexToText } from '../math/fromlatex';
import { buildEvalContext } from '../scope';
import { parseEntry } from '../math/parse';
import { checkSpec } from '../api/check';
import { createGraphBridge } from '../script/graphBridge';
import { graphEntryData } from '../script/protocol';
import { SOLUTION_IN_EQUATION } from './solutions';
import { springBallDemo } from '../demos/springBall';
import type { Entry, Viewport } from '../../store/types';

const VP: Viewport = { tMin: -2, tMax: 8, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: extra.id ?? `s${n++}`,
  raw,
  color: '#000000',
  visible: true,
  expanded: false,
  ...extra,
});
const run = (entries: Entry[], vp = VP) => computeAll(entries, vp, 800);
const scopeOf = (entries: Entry[]) =>
  buildEvalContext(entries.map((entry) => ({ entry, parsed: parseEntry(entry.raw) }))).scope as unknown as Record<
    string,
    (t: number) => number
  >;
const pointOf = (r: CurveResult | undefined) => {
  expect(r?.error).toBeUndefined();
  expect(r?.points?.length).toBe(1);
  return r!.points![0];
};

describe('ODE solutions as functions: y(T)', () => {
  it('matches the drawn curve', () => {
    for (const solver of ['rk4', 'auto', 'rk45', 'euler'] as const) {
      const ode = E("y'' = -c*y - 0.2*y'", { ic: [3, 0], solver });
      const entries = [E('c = 2'), ode];
      const res = run(entries);
      const curve = res.get(ode.id)!.curve;
      // compute uses the drawn curve's step for the fixed-step methods.
      const ctx = buildEvalContext(
        entries.map((entry) => ({ entry, parsed: parseEntry(entry.raw) })),
        { odeStep: (VP.tMax - VP.tMin) / 800 },
      );
      const y = ctx.scope.y as unknown as (t: number) => number;
      let worst = 0;
      let count = 0;
      for (const seg of curve.segments) {
        for (const [t, v] of seg) {
          worst = Math.max(worst, Math.abs(y(t) - v));
          count++;
        }
      }
      expect(count).toBeGreaterThan(100);
      expect(worst).toBeLessThan(solver === 'euler' ? 2e-2 : 1e-6);
    }
  });

  it('moves a point along the solution: (T, y(T)), B = (0, y(T))', () => {
    const entries = [E('T = 1.3'), E("y'' = -y", { ic: [3, 0] }), E('(T, y(T))'), E('B = (0, y(T))')];
    const res = run(entries);
    const [t, v] = pointOf(res.get(entries[2].id));
    expect(t).toBe(1.3);
    expect(v).toBeCloseTo(3 * Math.cos(1.3), 7);
    expect(pointOf(res.get(entries[3].id))[1]).toBeCloseTo(3 * Math.cos(1.3), 7);
  });

  it('honours typed conditions (same row and own row)', () => {
    const a = [E('c = 4'), E("y'' = -c*y, y(0)=3, y'(0)=0"), E('(1, y(1))')];
    expect(pointOf(run(a).get(a[2].id))[1]).toBeCloseTo(3 * Math.cos(2), 7);
    const b = [E("y' = -y"), E('y(1) = 2'), E('(3, y(3))'), E('(0, y(0))')];
    const rb = run(b);
    expect(pointOf(rb.get(b[2].id))[1]).toBeCloseTo(2 * Math.exp(-2), 7);
    // Backwards from t0 = 1 too.
    expect(pointOf(rb.get(b[3].id))[1]).toBeCloseTo(2 * Math.exp(1), 6);
  });

  it('honours t0 and IC sliders', () => {
    const entries = [E("y' = y", { t0: 1, ic: [2] }), E('(2, y(2))'), E('(-3, y(-3))')];
    const res = run(entries);
    expect(pointOf(res.get(entries[1].id))[1]).toBeCloseTo(2 * Math.E, 6);
    expect(pointOf(res.get(entries[2].id))[1]).toBeCloseTo(2 * Math.exp(-4), 7);
  });

  it('honours boundary values (typed and the Conditions switch)', () => {
    const typed = [E("y'' = -y, y(0) = 0, y(pi/2) = 1"), E('(1, y(1))')];
    expect(pointOf(run(typed).get(typed[1].id))[1]).toBeCloseTo(Math.sin(1), 6);
    const sw = [E("y'' = 0", { conditions: 'boundary', bc: [0, 1, 2, 5] }), E('(1, y(1))'), E("(1, y'(1))")];
    const r = run(sw);
    expect(pointOf(r.get(sw[1].id))[1]).toBeCloseTo(3, 6);
    expect(pointOf(r.get(sw[2].id))[1]).toBeCloseTo(2, 6);
  });

  it('honours delta and step forcing', () => {
    const imp = [E("y' = -y + 2*delta(t - 1), y(0) = 1"), E('(2, y(2))'), E('(0.5, y(0.5))')];
    const r = run(imp);
    expect(pointOf(r.get(imp[1].id))[1]).toBeCloseTo(Math.exp(-2) + 2 * Math.exp(-1), 6);
    expect(pointOf(r.get(imp[2].id))[1]).toBeCloseTo(Math.exp(-0.5), 7);
    const step = [E("y' = H(t - 1), y(0) = 0"), E('(3, y(3))'), E('(0.5, y(0.5))')];
    const rs = run(step);
    expect(pointOf(rs.get(step[1].id))[1]).toBeCloseTo(2, 6);
    expect(pointOf(rs.get(step[2].id))[1]).toBeCloseTo(0, 7);
  });

  it('gives derivatives up to the equation order', () => {
    const y = scopeOf([E('c = 4'), E("y'' = -c*y, y(0)=3, y'(0)=0")]);
    expect(y.D1_y(0.7)).toBeCloseTo(-6 * Math.sin(1.4), 6);
    expect(y.D2_y(0.7)).toBeCloseTo(-12 * Math.cos(1.4), 5);
    const first = scopeOf([E("y' = 2*y, y(0) = 1")]);
    expect(first.D1_y(1)).toBeCloseTo(2 * Math.exp(2), 4);
    expect(first.D2_y).toBeUndefined();
  });

  it('works for systems and draws the phase curve (x(t), y(t))', () => {
    const entries = [E("x' = -y", { ic: [2] }), E("y' = x", { ic: [0] }), E('(x(t), y(t))', { thetaMin: 0, thetaMax: 6.283185307179586 })];
    const r = run(entries).get(entries[2].id)!;
    expect(r.error).toBeUndefined();
    const pts = r.curve.segments.flat();
    expect(pts.length).toBeGreaterThan(100);
    for (const [px, py] of pts) expect(Math.hypot(px, py)).toBeCloseTo(2, 6);
  });

  it('works in functions, derived values, inequalities and colours', () => {
    const entries = [
      E('T = 2'),
      E("y'' = -y, y(0) = 1, y'(0) = 0"),
      E('f = y(t)^2'),
      E('y = 2*y(x)'),
      E("E = y'(T)^2/2 + y(T)^2/2"),
      E('y < y(x)'),
      E('p = y(1)'),
    ];
    const r = run(entries);
    const f = r.get(entries[2].id)!;
    expect(f.error).toBeUndefined();
    for (const [t, v] of f.curve.segments.flat()) expect(v).toBeCloseTo(Math.cos(t) ** 2, 6);
    const g = r.get(entries[3].id)!;
    expect(g.curve.segments.flat().length).toBeGreaterThan(100);
    for (const [t, v] of g.curve.segments.flat()) expect(v).toBeCloseTo(2 * Math.cos(t), 6);
    expect(r.get(entries[4].id)!.value).toBeCloseTo(0.5, 8);
    const ineq = r.get(entries[5].id)!;
    expect(ineq.error).toBeUndefined();
    expect(ineq.inequality!.test(0, 0.5)).toBe(true);
    expect(ineq.inequality!.test(0, 1.5)).toBe(false);
    expect(r.get(entries[6].id)!.value).toBeCloseTo(Math.cos(1), 7);
  });

  it('invalidates cached curves when the equation, a slider or the IC changes', () => {
    const f = E('f = y(t)', { id: 'fcache' });
    const mk = (c: number, ic: number[]) => [E(`c = ${c}`, { id: 'ccache' }), E("y'' = -c*y", { id: 'ocache', ic }), f];
    const at1 = (entries: Entry[]) => {
      const seg = run(entries).get('fcache')!.curve.segments.flat();
      return seg.reduce((best, p) => (Math.abs(p[0] - 1) < Math.abs(best[0] - 1) ? p : best))[1];
    };
    const base = at1(mk(1, [1, 0]));
    expect(base).toBeCloseTo(Math.cos(1), 2);
    expect(at1(mk(4, [1, 0]))).toBeCloseTo(Math.cos(2), 2);
    expect(at1(mk(4, [2, 0]))).toBeCloseTo(2 * Math.cos(2), 2);
    expect(at1(mk(1, [1, 0]))).toBe(base);
  });

  it('lets user functions and typed conditions keep their meaning', () => {
    // A user function wins over the solution of an ODE with the same name.
    const s = scopeOf([E("w' = -w"), E('w(s) = s^2')]);
    expect(s.w(3)).toBe(9);
    // A condition row is a condition, not an evaluation.
    const entries = [E("y' = y"), E('y(0) = 2'), E('(1, y(1))')];
    const r = run(entries);
    expect(r.get(entries[1].id)!.error).toBeUndefined();
    expect(pointOf(r.get(entries[2].id))[1]).toBeCloseTo(2 * Math.E, 6);
    // u stays the unit step even with an ODE in u.
    const u = scopeOf([E("u' = -u")]);
    expect(u.u(1)).toBe(1);
  });

  it('gives row errors (never throws) for cycles and unsolvable cases', () => {
    const self = [E("y'' = -y + y(1)"), E('(1, y(1))')];
    const r = run(self);
    expect(r.get(self[0].id)!.error).toBe(SOLUTION_IN_EQUATION);
    expect(r.get(self[1].id)!.error).toMatch(/can't use a solution/);
    // Through a derived value: k = y(1) and y' = k*y.
    const cyc = [E('k = y(1)'), E("y' = k*y"), E('(1, y(1))')];
    const rc = run(cyc);
    expect(rc.get(cyc[0].id)!.error).toMatch(/Circular/);
    expect(rc.get(cyc[2].id)!.error).toBeTruthy();
    // Through a user function.
    const viaFn = [E('g(s) = y(s)'), E("y' = g(t)"), E('(1, y(1))')];
    const rf = run(viaFn);
    expect(rf.get(viaFn[1].id)!.error).toMatch(/can't use a solution/);
    // An unsolvable boundary problem.
    const bvp = [E("y'' = -y, y(0) = 0, y(pi) = 1"), E('(1, y(1))')];
    expect(run(bvp).get(bvp[1].id)!.error).toMatch(/y\(…\): No solution/);
    // A condition reading a solution.
    const cond = [E("y' = y, y(0) = y(1)"), E('(1, y(1))')];
    expect(run(cond).get(cond[1].id)!.error).toMatch(/condition can't use a solution/);
    // No ODE for z; the wrong number of arguments; a non-number.
    const misc = [E("y' = y"), E('(1, z(1))'), E('(1, y(1, 2))'), E('q = y(1, 2)')];
    const rm = run(misc);
    expect(rm.get(misc[1].id)!.error).toMatch(/Unknown function: z/);
    expect(rm.get(misc[2].id)!.error).toMatch(/takes one argument/);
    expect(rm.get(misc[3].id)!.error).toMatch(/takes one argument/);
    // Out of range / past a blow-up: NaN, no point.
    const far = [E("y' = y^2, y(0) = 1"), E('(2, y(2))')];
    expect(run(far).get(far[1].id)!.points).toEqual([]);
  });

  it('is accepted by checkSpec with sensible summaries', () => {
    const r = checkSpec({
      expressions: [
        { expr: 'T = 1', min: 0, max: 10 },
        "y'' = -4*y, y(0) = 3, y'(0) = 0",
        '(0, y(T))',
        "E = y'(T)^2/2 + 2*y(T)^2",
        { expr: '(T, y(T))', colorExpr: 'hsv(120*y(T), 1, 1)' },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.expressions.map((e) => e.kind)).toEqual(['variable', 'ode', 'points', 'function', 'points']);
    expect(r.expressions[2].summary).toMatch(/using the ODE solution y\(…\)/);
    expect(r.expressions[3].summary).toMatch(/derived value E, using the ODE solution y'\(…\), y\(…\)/);
    // Not a solution: still an unknown function.
    const bad = checkSpec({ expressions: ['(0, q(1))'] });
    expect(bad.ok).toBe(false);
  });
});

describe('solution calls in the editor', () => {
  it('render as calls and survive the LaTeX round trip', () => {
    for (const raw of ["E = y'(T)^2/2 + 2y(T)^2", 'f = y(t)^2/3', "q = x(T)*y''(T)", "p = theta'(T)^2"]) {
      const before = parseEntry(raw);
      const tex = entryToLatex(before)!;
      expect(tex).not.toMatch(/D\d|mathrm\{y/);
      const after = parseEntry(latexToText(tex));
      expect(after.kind, tex).toBe(before.kind);
      expect([...callsOf(after)].sort(), tex).toEqual([...callsOf(before)].sort());
    }
  });
});

describe('the spring-ball demo', () => {
  it('keeps the ball on the drawn curve while T plays, cheaply', () => {
    const g = springBallDemo();
    const ode = g.entries[0];
    const dotId = g.entries.find((e) => e.raw === '(T, y(T))')!.id;
    const springId = g.entries.find((e) => e.raw.startsWith('(T + 0.3'))!.id;
    const energyId = g.entries.find((e) => e.raw.startsWith('E ='))!.id;
    const withT = (T: number) => g.entries.map((e) => (e.raw === 'T = 0' ? { ...e, varValue: T } : e));
    let lastE = Infinity;
    const started = performance.now();
    for (let i = 0; i <= 200; i++) {
      const T = i * 0.1;
      const res = computeAll(withT(T), g.viewport, 1200);
      for (const e of g.entries) expect(res.get(e.id)!.error, e.raw).toBeUndefined();
      const [td, yd] = pointOf(res.get(dotId));
      // The spring ends at the ball.
      const coil = res.get(springId)!.curve.segments.flat();
      expect(coil.at(-1)![0]).toBeCloseTo(td, 9);
      expect(coil.at(-1)![1]).toBeCloseTo(yd, 9);
      // On the drawn curve: compare with the nearest curve vertex.
      const pts = res.get(ode.id)!.curve.segments.flat();
      // On the drawn polyline (linear between its vertices, ~0.02 apart).
      const j = Math.max(1, pts.findIndex((p) => p[0] >= td - 1e-12));
      expect(pts[j][0] - pts[j - 1][0]).toBeLessThan(0.05);
      const [a, b] = [pts[Math.max(0, j - 1)], pts[j]];
      const onLine = b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (td - a[0])) / (b[0] - a[0]);
      expect(Math.abs(onLine - yd)).toBeLessThan(2e-3);
      const E = res.get(energyId)!.value!;
      expect(E).toBeLessThanOrEqual(lastE + 1e-9);
      lastE = E;
    }
    // 201 frames (curves cached, the solution only extended): well under a frame each.
    expect(performance.now() - started).toBeLessThan(4000);
  });
});

describe('Script mode bridge uses the same solution', () => {
  it('honours typed conditions, boundary mode, solver and impulses', () => {
    const entries = [
      E('c = 4'),
      E("y'' = -c*y, y(0)=3, y'(0)=0"),
      E("z'' = 0", { conditions: 'boundary', bc: [0, 1, 2, 5], solver: 'auto' }),
      E("w' = -w + delta(t - 1), w(0) = 1"),
    ];
    const bridge = createGraphBridge(entries.map(graphEntryData));
    const y = bridge.ode('y', 0)!;
    const s = scopeOf(entries);
    for (const t of [-1.5, 0, 0.3, 2.7, 9]) expect(y(t)).toBe(s.y(t));
    expect(y(1)).toBeCloseTo(3 * Math.cos(2), 7);
    expect(bridge.ode('y', 1)!(1)).toBeCloseTo(-6 * Math.sin(2), 6);
    expect(bridge.ode('z', 0)!(1)).toBeCloseTo(3, 6);
    expect(bridge.ode('w', 0)!(2)).toBeCloseTo(Math.exp(-2) + Math.exp(-1), 6);
    expect(bridge.ode('nope', 0)).toBeUndefined();
  });
});
