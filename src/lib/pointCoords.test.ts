import { describe, expect, it } from 'vitest';
import { computeAll, type CurveResult } from './compute';
import { parseEntry } from './math/parse';
import { normalizeInput } from './math/normalize';
import { entryToLatex } from './math/tolatex';
import { latexToText } from './math/fromlatex';
import { buildVarScope, resolveSlice } from './math/resolveSlice';
import { evalColor } from './color';
import { checkSpec } from './api/check';
import { rewriteCoords, splitCoord, prettyCoords } from './math/coords';
import type { Entry, Viewport } from '../store/types';

// Desmos-style point coordinates: A.x / A.y of a named point A = (…, …).

const VP: Viewport = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: extra.id ?? `pc${n++}`,
  raw,
  color: '#000000',
  visible: true,
  expanded: false,
  ...extra,
});
const run = (es: Entry[]) => computeAll(es, VP, 400);
const ok = (r: CurveResult | undefined) => {
  expect(r).toBeDefined();
  expect(r!.error).toBeUndefined();
  expect(r!.undefinedVars ?? []).toEqual([]);
  return r!;
};
const first = (r: CurveResult) => r.curve.segments[0][0];

describe('A.x / A.y: the rewrite', () => {
  it('rewrites name.prop to an internal symbol, leaving numbers alone', () => {
    expect(rewriteCoords('center.x + 0.5cos(t)')).toBe('center__x + 0.5cos(t)');
    expect(rewriteCoords('(A.x, A.y + 1.25)')).toBe('(A__x, A__y + 1.25)');
    expect(rewriteCoords('a_1.y')).toBe('a_1__y');
    expect(rewriteCoords('k = 0..n')).toBe('k = 0..n');
    expect(normalizeInput('ω.x')).toBe('omega__x');
    expect(splitCoord('a_1__y')).toEqual({ point: 'a_1', prop: 'y' });
    expect(splitCoord('omega_0')).toBeNull();
    expect(prettyCoords('Undefined symbol A__x')).toBe('Undefined symbol A.x');
  });
  it('never leaves a mathjs property access', () => {
    expect(parseEntry('y = (A).x')).toMatchObject({ kind: 'error' });
    expect(parseEntry('y = [1, 2].x')).toMatchObject({ kind: 'error' });
    expect(parseEntry('y = A.x.y')).toMatchObject({ kind: 'error' });
    expect(parseEntry('y = A .x')).toMatchObject({ kind: 'error' });
    expect(normalizeInput('y = 2center.x')).toBe('y = 2center__x');
    expect(parseEntry('A.x = 3')).toMatchObject({ kind: 'error', message: expect.stringMatching(/define A = /) });
  });
  it('classifies each use site', () => {
    expect(parseEntry('y = center.x').kind).toBe('function');
    expect(parseEntry('k = center.x').kind).toBe('function');
    expect(parseEntry('(center.x, 3)').kind).toBe('points');
    expect(parseEntry('B = (A.x, 0)').kind).toBe('pointvar');
    expect(parseEntry('(A.x + cos(t), A.y + sin(t))').kind).toBe('parametric');
    expect(parseEntry('y < A.y').kind).toBe('inequality');
    expect(parseEntry('(x - A.x)^2 + (y - A.y)^2 = 1').kind).toBe('implicit');
    expect(parseEntry('r = A.x').kind).toBe('polar');
    expect(parseEntry('f(u) = u + A.x').kind).toBe('fndef');
  });
});

describe('A.x / A.y: every use site', () => {
  const a = () => E('a = 2');
  const A = () => E('A = (a, 1)');
  it('points, named points and segments', () => {
    const es = [a(), A(), E('(A.x, A.y + 1)'), E('B = (A.x + 1, A.y)'), E('((A.x, 0), (B.x, B.y))')];
    const r = run(es);
    expect(ok(r.get(es[2].id)).points).toEqual([[2, 2]]);
    expect(ok(r.get(es[3].id)).points).toEqual([[3, 1]]);
    expect(ok(r.get(es[4].id)).points).toEqual([
      [2, 0],
      [3, 1],
    ]);
  });
  it('functions, derived values (live value), restrictions, piecewise', () => {
    const es = [
      a(),
      A(),
      E('y = A.y'),
      E('y = (x - A.x)^2 + A.y'),
      E('d = sqrt(A.x^2 + A.y^2)'),
      E('y = x {x < A.x}'),
      E('y = {x < A.x: 1, 2}'),
    ];
    const r = run(es);
    expect(first(ok(r.get(es[2].id)))[1]).toBe(1);
    const parab = ok(r.get(es[3].id)).curve.segments.flat();
    const vertex = parab.reduce((m, p) => (p[1] < m[1] ? p : m));
    expect(vertex[0]).toBeCloseTo(2, 1);
    expect(vertex[1]).toBeCloseTo(1, 2);
    expect(ok(r.get(es[4].id)).value).toBeCloseTo(Math.sqrt(5));
    const restricted = ok(r.get(es[5].id)).curve.segments.flat();
    expect(Math.max(...restricted.map((p) => p[0]))).toBeLessThanOrEqual(2.01);
    const pw = ok(r.get(es[6].id)).curve.segments.flat();
    expect(pw.find((p) => p[0] < 1)![1]).toBe(1);
    expect(pw.find((p) => p[0] > 3)![1]).toBe(2);
  });
  it('parametric, implicit, polar curves and inequalities', () => {
    const es = [
      a(),
      A(),
      E('(A.x + cos(t), A.y + sin(t))'),
      E('(x - A.x)^2 + (y - A.y)^2 = 1'),
      E('r = A.x'),
      E('y < A.y'),
    ];
    const r = run(es);
    for (const [x, y] of ok(r.get(es[2].id)).curve.segments[0]) expect(Math.hypot(x - 2, y - 1)).toBeCloseTo(1);
    for (const [x, y] of ok(r.get(es[3].id)).curve.segments.flat()) expect(Math.hypot(x - 2, y - 1)).toBeCloseTo(1, 1);
    for (const [x, y] of ok(r.get(es[4].id)).curve.segments.flat()) expect(Math.hypot(x, y)).toBeCloseTo(2);
    const ineq = ok(r.get(es[5].id)).inequality!;
    expect(ineq.test(0, 0.5)).toBe(true);
    expect(ineq.test(0, 1.5)).toBe(false);
  });
  it('user-function bodies, repeats, colour and slice expressions', () => {
    const es = [a(), A(), E('f(u) = u + A.x'), E('y = f(x)'), E('(A.x + k, 0) for k = 1..2')];
    const r = run(es);
    expect(first(ok(r.get(es[3].id)))).toEqual([-5, -3]);
    expect(ok(r.get(es[4].id)).points).toEqual([
      [3, 0],
      [4, 0],
    ]);
    const scope = buildVarScope(es);
    expect(resolveSlice('A.x + 1', scope)).toBe(3);
    expect(evalColor('rgb(100 A.x, 0, 0)', scope)).toMatchObject({ r: 200 });
  });
  it('ODE right-hand sides and conditions (acyclic)', () => {
    const es = [a(), A(), E("y' = -A.x y"), E('y(0) = A.y')];
    const r = run(es);
    const seg = ok(r.get(es[2].id)).curve.segments[0];
    const at1 = seg.reduce((m, p) => (Math.abs(p[0] - 1) < Math.abs(m[0] - 1) ? p : m));
    expect(at1[1]).toBeCloseTo(Math.exp(-2), 2);
  });
});

describe('A.x / A.y: chains, cycles, errors', () => {
  it('resolves chains in dependency order, whatever the row order', () => {
    const es = [E('C = (B.x, 0)'), E('B = (A.x + 1, A.y)'), E('A = (a, 1)'), E('a = 2')];
    const r = run(es);
    expect(ok(r.get(es[0].id)).points).toEqual([[3, 0]]);
    expect(ok(r.get(es[1].id)).points).toEqual([[3, 1]]);
  });
  it('derived values and points may read each other', () => {
    const es = [E('A = (1, 2)'), E('s = A.x + A.y'), E('B = (s, 0)')];
    expect(ok(run(es).get(es[2].id)).points).toEqual([[3, 0]]);
  });
  it('reports cycles on the rows of the cycle, and downstream rows clearly', () => {
    const es = [E('A = (B.x, 0)'), E('B = (A.x, 1)'), E('C = (C.x + 1, 0)'), E('y = A.y'), E('d = B.x')];
    const r = run(es);
    expect(r.get(es[0].id)!.error).toBe('Circular definition');
    expect(r.get(es[1].id)!.error).toBe('Circular definition');
    expect(r.get(es[2].id)!.error).toBe('Circular definition');
    expect(r.get(es[3].id)!.error).toMatch(/^A has no value/);
    expect(r.get(es[4].id)!.error).toMatch(/B has no value|no value yet/);
  });
  it('explains .x on something that is not a point', () => {
    const es = [E('k = 3'), E('f(u) = u'), E("X' = -X"), E('A = (1, 2)')];
    const ask = (raw: string) => {
      const e = E(raw);
      return run([...es, e]).get(e.id)!;
    };
    expect(ask('y = k.x').error).toBe('k.x: k is a number, not a point');
    expect(ask('y = f.y').error).toMatch(/f is a function, not a point/);
    expect(ask('y = X.x').error).toMatch(/X is an ODE solution, not a point/);
    expect(ask('y = A.z').error).toBe('A.z: a point has .x and .y');
    expect(ask('y = t.x').error).toMatch(/t isn't a point/);
  });
  it('an undefined point is prompted for as a point, not a slider', () => {
    const e = E('y = center.x');
    const r = run([e]).get(e.id)!;
    expect(r.undefinedVars).toEqual(['center']);
    expect(r.undefinedPoints).toEqual(['center']);
    const c = checkSpec({ expressions: ['y = Q.x'] });
    expect(c.errors[0].message).toMatch(/Add a point such as "Q = \(1, 2\)"/);
  });
  it("a defined point is never reported as 'undefined variable'", () => {
    const c = checkSpec({ expressions: ['center = (1, 2)', 'y = center.x', '(center.x, 3)', 'k = center.x'] });
    expect(c.errors).toEqual([]);
  });
  it('never throws on odd input', () => {
    for (const raw of ['A.', '.x', 'A..x', 'y = A.x.y', 'A.x(2)', 'y = A.constructor', 'y = A.__proto__', 'A = (A.x, A.y)']) {
      const e = E(raw);
      expect(() => run([E('A = (1, 2)'), e])).not.toThrow();
    }
    const e = E('y = A.constructor');
    expect(run([E('A = (1, 2)'), e]).get(e.id)!.error).toMatch(/a point has .x and .y/);
  });
});

describe('A.x / A.y: ODE solution points, drags and caches', () => {
  // The user's graph: a damped oscillator, a T slider, a point riding on it.
  const graph = (T: number) => [
    E("X'' = -1.8X - 0.5X'", { id: 'ode', ic: [4, 0], t0: 0 }),
    E(`T = ${T}`, { id: 'T', varValue: T }),
    E('center = (X(T) + 4, 2)', { id: 'center' }),
    E('(center.x + 0.5cos(t), center.y + 0.5sin(t))', { id: 'circle' }),
    E('y = center.y', { id: 'line' }),
  ];
  it('a point using X(T) follows T, and so does a circle around it', () => {
    const run = (es: Entry[]) => computeAll(es, { tMin: -2, tMax: 12, yMin: -5, yMax: 5 }, 400);
    const at0 = run(graph(0));
    expect(ok(at0.get('center')).points![0][0]).toBeCloseTo(8, 3);
    const c0 = ok(at0.get('circle')).curve.segments[0][0];
    expect(c0[0]).toBeCloseTo(8.5, 3);
    const at1 = run(graph(1));
    const x1 = ok(at1.get('center')).points![0][0];
    expect(x1).toBeLessThan(8);
    expect(ok(at1.get('circle')).curve.segments[0][0][0]).toBeCloseTo(x1 + 0.5, 6);
    expect(first(ok(at1.get('line')))[1]).toBe(2);
  });
  it('re-samples a cached curve when the point moves (and only then)', () => {
    const es = [E('a = 1', { id: 'a' }), E('A = (a, 0)', { id: 'A' }), E('(A.x + cos(t), sin(t))', { id: 'c' })];
    const r1 = run(es).get('c')!;
    const again = run(es).get('c')!;
    expect(again).toBe(r1); // cache hit
    // A drag of A writes the slider a: the dependant follows.
    const moved = [{ ...es[0], varValue: 3 }, es[1], es[2]];
    const r2 = run(moved).get('c')!;
    expect(r2).not.toBe(r1);
    expect(r2.curve.segments[0][0][0]).toBeCloseTo(4);
  });
  it('dependants follow a dragged point through a chain', () => {
    const es = (a: number, b: number) => [
      E('a = 1', { id: 'a', varValue: a }),
      E('b = 1', { id: 'b', varValue: b }),
      E('A = (a, b)', { id: 'A' }),
      E('B = (A.x + 1, A.y)', { id: 'B' }),
      E('C = (B.x, 0)', { id: 'C' }),
    ];
    const r = run(es(-2, 3));
    expect(r.get('A')!.points).toEqual([[-2, 3]]);
    expect(r.get('B')!.points).toEqual([[-1, 3]]);
    expect(r.get('C')!.points).toEqual([[-1, 0]]);
    // A is still draggable: its coordinates are the sliders a, b.
    expect(r.get('A')!.parsed).toMatchObject({ xSym: 'a', ySym: 'b' });
  });
  it('an ODE reading a point that reads its own solution is a clear error', () => {
    const es = [E("X' = -A.x", { id: 'o', ic: [1] }), E('A = (X(1), 0)', { id: 'P' })];
    const r = run(es);
    expect(r.get('P')!.error).toMatch(/Circular definition/);
    expect(r.get('P')!.error).toContain('A.x');
    expect(r.get('o')!.error).toMatch(/A has no value/);
  });
});

describe('A.x / A.y: display and editor round trip', () => {
  const round = (raw: string) => {
    const tex = entryToLatex(parseEntry(raw));
    expect(tex).not.toBeNull();
    return { tex: tex!, text: latexToText(tex!) };
  };
  it('renders A.x as A.x', () => {
    expect(round('y = A.y').tex.trim()).toBe('y = \\mathit{A}.y');
    expect(round('y = 2center.x').tex).toContain('2~\\mathit{center}.x');
    expect(round('d = sqrt(center.x^2 + center.y^2)').tex).toContain('\\mathit{center}.x');
    expect(round('y = ω.x').tex).toContain('\\mathit{\\omega}.x');
  });
  it('keeps A.x through the editor', () => {
    for (const raw of ['y = A.y', 'y = (x - A.x)^2 + A.y', 'd = sqrt(center.x^2 + center.y^2)', 'y = 2center.x', 'y = a_1.x', '(A.x + cos(t), A.y + sin(t))']) {
      const back = parseEntry(round(raw).text);
      const orig = parseEntry(raw);
      expect(back.kind).toBe(orig.kind);
      expect('deps' in back && [...back.deps].sort()).toEqual('deps' in orig && [...orig.deps].sort());
    }
  });
  it('reads what MathLive emits for a typed dot', () => {
    expect(latexToText('y=center.x')).toBe('y=center.x');
    expect(latexToText('y=center\\ldotp x')).toBe('y=center.x');
    expect(latexToText('y=\\mathit{center}.y')).toBe('y=center.y');
  });
});
