import { describe, expect, it } from 'vitest';
import { computeAll, type CurveResult } from './compute';
import { parseEntry, type Parsed } from './math/parse';
import { entryToLatex } from './math/tolatex';
import { latexToText } from './math/fromlatex';
import { compileNode } from './math/compileCache';
import { computeFeatures } from './analysis/features';
import { checkSpec } from './api/check';
import type { Entry, Viewport } from '../store/types';

const VP: Viewport = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: extra.id ?? `pw${n++}`,
  raw,
  color: '#000000',
  visible: true,
  expanded: false,
  ...extra,
});
const run = (entries: Entry[], vp = VP) => computeAll(entries, vp, 400);
const one = (raw: string, extra: Partial<Entry> = {}, vp = VP): CurveResult => {
  const e = E(raw, extra);
  return run([e], vp).get(e.id)!;
};
const kind = (raw: string) => parseEntry(raw).kind;
const all = (r: CurveResult) => r.curve.segments.flat();
type Kind<K extends Parsed['kind']> = Extract<Parsed, { kind: K }>;
function as<K extends Parsed['kind']>(p: Parsed, k: K): Kind<K> {
  expect(p.kind, (p as { message?: string }).message).toBe(k);
  return p as Kind<K>;
}
const at = (p: Parsed, t: number, extra: Record<string, number> = {}) =>
  compileNode((p as { node: Parameters<typeof compileNode>[0] }).node).evaluate({ t, ...extra });
/** Largest |Δy| between neighbouring points of any segment. */
const maxStep = (r: CurveResult) => {
  let m = 0;
  for (const s of r.curve.segments) for (let i = 1; i < s.length; i++) m = Math.max(m, Math.abs(s[i][1] - s[i - 1][1]));
  return m;
};

describe('piecewise: parsing', () => {
  it('classifies every brace form as a function of x', () => {
    for (const raw of [
      'y = {x < 0: -x, x < 2: x^2}',
      'y = {x < 0: -x, x^2}',
      'y = {x > 0}',
      '{x > 0}',
      'y = {0 < x < 2: 1, -1 <= x <= 0: 2}',
      'y = {x < -1 or x > 1: 1, 0}',
      'y = {x > 0 and x < 1: 1}',
      'y = {x = 1: 5, 0}',
      'y = {x < 0: {x < -1: 1, 2}, 3}',
      'y = 2 + {x > 0: x, -x}',
      'y = x < 0 ? -x : x^2',
      'y = t > 3 ? -t : t',
      'y = x > 3 ? -x : x',
    ]) {
      expect(kind(raw), raw).toBe('function');
    }
  });

  it('evaluates the first true piece, the else branch, and undefined otherwise', () => {
    const p = parseEntry('y = {x < 0: -x, x < 2: x^2}');
    expect(at(p, -3)).toBe(3);
    expect(at(p, 1.5)).toBe(2.25);
    expect(at(p, 3)).toBeNaN();
    const q = parseEntry('y = {x < 0: -x, x^2}');
    expect(at(q, 3)).toBe(9);
    const c = parseEntry('{x > 0}');
    expect(at(c, 1)).toBe(1);
    expect(at(c, -1)).toBeNaN();
    const chain = parseEntry('y = {-1 <= x <= 1: 7}');
    expect(at(chain, -1)).toBe(7);
    expect(at(chain, 1)).toBe(7);
    expect(at(chain, 1.01)).toBeNaN();
    const eq = parseEntry('y = {x = 1: 5, 0}');
    expect(at(eq, 1)).toBe(5);
    expect(at(eq, 2)).toBe(0);
    const or = parseEntry('y = {x < -1 or x > 1: 1, 0}');
    expect([at(or, -2), at(or, 0), at(or, 2)]).toEqual([1, 0, 1]);
    const nested = parseEntry('y = {x < 0: {x < -1: 1, 2}, 3}');
    expect([at(nested, -2), at(nested, -0.5), at(nested, 1)]).toEqual([1, 2, 3]);
  });

  it('counts pieces', () => {
    expect(as(parseEntry('y = {x < 0: -x, x < 2: x^2}'), 'function').pieces).toBe(2);
    expect(as(parseEntry('y = {x < 0: -x, x < 2: x^2, 5}'), 'function').pieces).toBe(3);
    expect(as(parseEntry('y = x < 0 ? -x : x^2'), 'function').pieces).toBe(2);
  });

  it('works inside user functions, derived values and ODEs', () => {
    const f = as(parseEntry('f(x) = {x < 0: 0, x}'), 'fndef');
    expect(f.node.evaluate({ x: -1 })).toBe(0);
    expect(f.node.evaluate({ x: 2 })).toBe(2);
    expect(kind('b = {a > 0: 1, -1}')).toBe('function'); // derived value
    const ode = as(parseEntry("y' = {t < 1: 1, 0}"), 'ode');
    expect(ode.breaks?.length).toBe(1);
    expect(as(parseEntry("y' = t < 1 ? 1 : 0"), 'ode').order).toBe(1);
  });

  it('parses restrictions for every curve kind', () => {
    const cases: [string, Parsed['kind'], string[]][] = [
      ['y = x^2 {0 < x < 2}', 'function', ['0 < x < 2']],
      ['y = x^2, 0 < x < 2', 'function', ['0 < x < 2']],
      ['y = x^2 {0 < x < 2} {x != 1}', 'function', ['0 < x < 2', 'x != 1']],
      ['x^2 {x > 0}', 'function', ['x > 0']],
      ['r = θ {0 < θ < pi}', 'polar', ['0 < θ < pi']],
      ['(cos(t), sin(t)) {t < pi}', 'parametric', ['t < pi']],
      ['x^2 + y^2 = 4 {y > 0}', 'implicit', ['y > 0']],
      ['x^2 + y^2 < 4 {y > 0}', 'inequality', ['y > 0']],
      ["y' = y {0 < t < 3}", 'ode', ['0 < t < 3']],
      ['f(x) = x^2 {x > 0}', 'fndef', ['x > 0']],
    ];
    for (const [raw, k, texts] of cases) {
      const p = parseEntry(raw);
      expect(p.kind, `${raw}: ${(p as { message?: string }).message}`).toBe(k);
      expect((p as { restrictions?: { text: string }[] }).restrictions?.map((r) => r.text), raw).toEqual(texts);
    }
    const rep = as(parseEntry('y = k x {x > 0} for k = 1..3'), 'repeat');
    expect(rep.body.kind).toBe('function');
    const rep2 = as(parseEntry('y = k x for k = 1..3 {x > 0}'), 'repeat');
    expect((rep2.body as Kind<'function'>).restrictions).toHaveLength(1);
    expect(rep2.loops[0].text).toBe('1..3');
  });

  it('a restriction written with x on a function of x is in the plotted variable', () => {
    const p = parseEntry('y = x^2 {0 < x < 2}');
    expect(at(p, 1)).toBe(1);
    expect(at(p, 3)).toBeNaN();
    expect(at(p, -1)).toBeNaN();
    // A restriction in x alone on a constant still restricts the horizontal axis.
    const c = parseEntry('y = 2 {x > 0}');
    expect(at(c, 1)).toBe(2);
    expect(at(c, -1)).toBeNaN();
    // y in a condition is the function's own value.
    const v = parseEntry('y = x^2 {y < 4}');
    expect(at(v, 1)).toBe(1);
    expect(at(v, 3)).toBeNaN();
  });

  it('reports malformed braces clearly, never throwing', () => {
    const bad = [
      '{', '}', '{{{', 'y = x^2 {', 'y = x^2 }', 'y = {}', 'y = {5}', 'y = {x < 0:}', 'y = {: 1}',
      'y = {x < 0: 1,, 2}', 'y = {x < 0: 1, 2, 3}', 'y = {a: 1, 2}', 'y = x^2 {5}', 'a = 2 {x > 0}',
      '(1, 2) {x > 0}', 'y = {x <: 1}', 'r = {θ < : 1}',
    ];
    for (const raw of bad) {
      let p: Parsed | undefined;
      expect(() => (p = parseEntry(raw)), raw).not.toThrow();
      expect(p!.kind, raw).toBe('error');
      expect((p as { message: string }).message.length, raw).toBeGreaterThan(3);
      expect(() => run([E(raw)]), raw).not.toThrow();
    }
    expect((parseEntry('y = {x < 0: 1, 2, 3}') as { message: string }).message).toMatch(/condition/);
    expect((parseEntry('y = x^2 {') as { message: string }).message).toMatch(/Unmatched/);
  });

  it('only ever evaluates known functions (links are untrusted)', () => {
    expect(one('y = {evil(x) > 0: 1}').unknownFns).toEqual(['evil']);
    expect(one('y = x {evil(x) > 0}').unknownFns).toEqual(['evil']);
    expect(one('x^2 + y^2 = 4 {evil(y) > 0}').unknownFns).toEqual(['evil']);
    expect(one('x^2 + y^2 < 4 {evil(y) > 0}').unknownFns).toEqual(['evil']);
  });
});

describe('piecewise: sampling', () => {
  it('y = t > 3 ? -t : t is a function with a clean jump at 3 (no vertical join)', () => {
    for (const raw of ['y = t > 3 ? -t : t', 'y = x > 3 ? -x : x', 'y = {t > 3: -t, t}', 'y = {x > 3: -x, x}']) {
      const r = one(raw, {}, { tMin: -5, tMax: 10, yMin: -10, yMax: 10 });
      expect(r.parsed.kind, raw).toBe('function');
      expect(r.curve.segments, raw).toHaveLength(2);
      const [a, b] = r.curve.segments;
      expect(a[a.length - 1][0]).toBeCloseTo(3, 9);
      expect(a[a.length - 1][1]).toBeCloseTo(3, 9);
      expect(b[0][0]).toBeCloseTo(3, 9);
      expect(b[0][1]).toBeCloseTo(-3, 9);
      // No point between the two pieces, and no big step inside a segment.
      expect(all(r).filter(([t]) => Math.abs(t - 3) < 0.05).every(([, y]) => Math.abs(y) > 2.9)).toBe(true);
      expect(a.every(([t]) => t < 3 + 1e-9)).toBe(true);
      expect(b.every(([t]) => t > 3 - 1e-9)).toBe(true);
      expect(maxStep(r)).toBeLessThan(0.1);
      const disc = computeFeatures(r.curve, { tMin: -5, tMax: 10, yMin: -10, yMax: 10 }).filter((f) => f.kind === 'discontinuity');
      expect(disc.map((f) => Math.round(f.y))).toEqual([3, -3]);
    }
  });

  it('a restricted function ends exactly on its bounds and draws nothing outside', () => {
    const r = one('y = x^2 {0 < x < 2}');
    expect(r.curve.segments).toHaveLength(1);
    const s = r.curve.segments[0];
    expect(s[0][0]).toBeCloseTo(0, 9);
    expect(s[s.length - 1][0]).toBeCloseTo(2, 9);
    expect(s[s.length - 1][1]).toBeCloseTo(4, 8);
    expect(all(r).every(([t]) => t >= 0 && t <= 2)).toBe(true);
    const f = computeFeatures(r.curve, VP);
    const ends = f.filter((x) => x.kind === 'endpoint').map((x) => x.t);
    expect(ends[0]).toBeCloseTo(0, 6);
    expect(ends[1]).toBeCloseTo(2, 6);
    // Comma form and chained ≤ are the same.
    const c = one('y = x^2, 0 <= x <= 2');
    expect(c.curve.segments).toHaveLength(1);
    expect(c.curve.segments[0].at(-1)![0]).toBeCloseTo(2, 9);
  });

  it('piecewise without else: nothing past the last condition; exact corner where pieces meet', () => {
    const r = one('y = {x < 0: -x, x < 2: x^2}');
    expect(all(r).every(([t]) => t <= 2 + 1e-9)).toBe(true);
    expect(all(r).at(-1)![0]).toBeCloseTo(2, 9);
    // Continuous at 0 (|x| style): one segment through an exact corner point.
    expect(r.curve.segments).toHaveLength(1);
    expect(all(r).some(([t, y]) => Math.abs(t) < 1e-9 && Math.abs(y) < 1e-9)).toBe(true);
    // A jump between defined pieces splits the curve.
    const j = one('y = {x < 1: 0, 2}');
    expect(j.curve.segments).toHaveLength(2);
    expect(j.curve.segments[0].at(-1)![0]).toBeCloseTo(1, 9);
    expect(j.curve.segments[1][0][0]).toBeCloseTo(1, 9);
  });

  it('a slider in a condition moves the edge (and invalidates the cache)', () => {
    const a = E('a = 1', { id: 'pw-a' });
    const f = E('y = x {x < a}', { id: 'pw-f' });
    const r1 = run([a, f]).get('pw-f')!;
    expect(all(r1).at(-1)![0]).toBeCloseTo(1, 9);
    const r2 = run([{ ...a, raw: 'a = 2' }, f]).get('pw-f')!;
    expect(all(r2).at(-1)![0]).toBeCloseTo(2, 9);
    const r3 = run([{ ...a, varValue: 3 }, f]).get('pw-f')!;
    expect(all(r3).at(-1)![0]).toBeCloseTo(3, 9);
    // The same through a piecewise value.
    const g = E('y = {x < a: 1, 2}', { id: 'pw-g' });
    const g1 = run([a, g]).get('pw-g')!;
    const g2 = run([{ ...a, varValue: -2 }, g]).get('pw-g')!;
    expect(g1.curve.segments[0].at(-1)![0]).toBeCloseTo(1, 9);
    expect(g2.curve.segments[0].at(-1)![0]).toBeCloseTo(-2, 9);
  });

  it('Desmos reference forms: y-conditions, mixed x + y, and = pieces', () => {
    const vp: Viewport = { tMin: -5, tMax: 5, yMin: 0, yMax: 20 };
    const band = one('y = x^2 {5 <= y <= 15}', {}, vp);
    expect(band.curve.segments).toHaveLength(2);
    for (const [, y] of all(band)) expect(y).toBeGreaterThanOrEqual(5 - 1e-6);
    for (const [, y] of all(band)) expect(y).toBeLessThanOrEqual(15 + 1e-6);
    expect(band.curve.segments[1][0][0]).toBeCloseTo(Math.sqrt(5), 6);
    expect(band.curve.segments[1].at(-1)![0]).toBeCloseTo(Math.sqrt(15), 6);
    const mixed = one('y = x^2 {x + y < 5}{x > 0}');
    const xEnd = (-1 + Math.sqrt(21)) / 2; // x + x^2 = 5
    expect(all(mixed).every(([t]) => t > -1e-9 && t < xEnd + 1e-6)).toBe(true);
    expect(all(mixed).at(-1)![0]).toBeCloseTo(xEnd, 6);
    const three = parseEntry('y = {x<0: -x, x=0: 0, x>0: 1}');
    expect([at(three, -2), at(three, 0), at(three, 2)]).toEqual([2, 0, 1]);
    const f = as(parseEntry('f(x) = {x<=0: 2x+1, 4x-3}'), 'fndef');
    expect([f.node.evaluate({ x: -1 }), f.node.evaluate({ x: 1 })]).toEqual([-1, 1]);
    // Polar restricted by r: r = θ until r reaches 3.
    const pr = one('r = θ {r < 3}');
    for (const [x, y] of all(pr)) expect(Math.hypot(x, y)).toBeLessThan(3 + 1e-6);
    expect(Math.hypot(...all(pr).at(-1)!)).toBeCloseTo(3, 6);
    // Inequality with a restriction mixing x and y.
    const reg = one('y < 4 {x + y > 0}');
    expect(reg.inequality!.test(1, 1)).toBe(true);
    expect(reg.inequality!.test(-3, 1)).toBe(false);
  });

  it('polar and parametric restrictions end on their bound', () => {
    const p = one('r = θ {0 < θ < pi}');
    const last = all(p).at(-1)!;
    expect(last[0]).toBeCloseTo(-Math.PI, 6);
    expect(last[1]).toBeCloseTo(0, 6);
    const q = one('(cos(t), sin(t)) {t < pi}');
    const e = all(q).at(-1)!;
    expect(e[0]).toBeCloseTo(-1, 8);
    expect(e[1]).toBeCloseTo(0, 6);
    expect(all(q).every(([, y]) => y >= -1e-9)).toBe(true);
    // A piecewise radius that jumps isn't joined.
    const j = one('r = {θ < pi: 1, 2}');
    expect(j.curve.segments.length).toBe(2);
  });

  it('implicit and inequality restrictions', () => {
    const c = one('x^2 + y^2 = 4 {y > 0}');
    expect(c.parsed.kind).toBe('implicit');
    expect(all(c).length).toBeGreaterThan(10);
    expect(all(c).every(([, y]) => y >= -1e-9)).toBe(true);
    const ends = c.curve.segments.flatMap((s) => [s[0], s[s.length - 1]]);
    expect(ends.some(([t, y]) => Math.abs(t - 2) < 0.05 && Math.abs(y) < 1e-6)).toBe(true);
    const r = one('x^2 + y^2 < 4 {y > 0}');
    expect(r.inequality!.test(0, 1)).toBe(true);
    expect(r.inequality!.test(0, -1)).toBe(false);
    expect(r.inequality!.test(0, 3)).toBe(false);
    expect(r.inequality!.boundaries.flatMap((b) => b.segments.flat()).every(([, y]) => y >= -1e-9)).toBe(true);
    const polar = one('r < 2 {0 < θ < pi/2}');
    expect(polar.inequality!.test(0.5, 0.5)).toBe(true);
    expect(polar.inequality!.test(-0.5, 0.5)).toBe(false);
  });

  it('an ODE restriction windows the drawn solution; a piecewise forcing integrates', () => {
    const r = one("y' = y {0 < t < 3}", { ic: [1], t0: 0 });
    expect(r.error).toBeUndefined();
    const pts = all(r);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts.every(([t]) => t >= -1e-9 && t <= 3 + 1e-9)).toBe(true);
    expect(pts.at(-1)![0]).toBeCloseTo(3, 6);
    const f = one("y' = {t < 1: 1, 0}", { ic: [0], t0: 0 });
    expect(f.error).toBeUndefined();
    const end = all(f).filter(([t]) => t > 3.9 && t < 4.1)[0];
    expect(end[1]).toBeCloseTo(1, 4);
  });

  it('user functions and derived values use piecewise values', () => {
    const fd = E('f(x) = {x < 0: 0, x}', { id: 'pw-fd' });
    const use = E('y = f(x) + 1', { id: 'pw-use' });
    const a = E('a = 2', { id: 'pw-a2' });
    const d = E('b = {a > 0: 1, -1}', { id: 'pw-d' });
    const res = run([fd, use, a, d]);
    expect(res.get('pw-use')!.error).toBeUndefined();
    for (const [t, y] of all(res.get('pw-use')!)) expect(y).toBeCloseTo(t < 0 ? 1 : t + 1, 9);
    expect(res.get('pw-d')!.value).toBe(1);
    // A plotted f(x) = {…} definition jumps cleanly too.
    const step = E('s(x) = {x < 1: 0, 2}', { id: 'pw-s' });
    expect(run([step]).get('pw-s')!.curve.segments).toHaveLength(2);
  });
});

describe('piecewise: LaTeX round trip', () => {
  const roundTrip = (raw: string) => {
    const p = parseEntry(raw);
    const tex = entryToLatex(p);
    expect(tex, raw).not.toBeNull();
    return { p, tex: tex!, back: parseEntry(latexToText(tex!)) };
  };
  const same = (a: Parsed, b: Parsed, ts = [-3, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3.5]) => {
    expect(b.kind).toBe(a.kind);
    for (const t of ts) {
      const x = at(a, t);
      const y = at(b, t);
      if (Number.isNaN(x)) expect(y).toBeNaN();
      else expect(y).toBe(x);
    }
  };

  it('displays piecewise Desmos-style and parses it back', () => {
    for (const raw of [
      'y = {x < 0: -x, x < 2: x^2}',
      'y = {x < 0: -x, x^2}',
      'y = {x > 0}',
      'y = x < 0 ? -x : x^2',
      'y = t > 3 ? -t : t',
      'y = {-1 <= x <= 1: 1, 0}',
      'y = {x = 1: 5, 0}',
      'y = {x != 1: 5}',
      'y = {x < -1 or x > 1: 1, 0}',
      'y = {x > -1 and x < 1: 1, 0}',
      'y = {x < 0: {x < -1: 1, 2}, 3}',
      'y = x^2 {0 < x < 2}',
      'y = x^2 {0 < x < 2} {x > 1}',
    ]) {
      const { p, tex, back } = roundTrip(raw);
      expect(tex).not.toMatch(/cases/);
      expect(tex, raw).toMatch(/\\left\\\{/);
      same(p, back);
    }
  });

  it('round-trips restrictions on other kinds and leaves ordinary rows alone', () => {
    for (const raw of ['r = θ {0 < θ < pi}', '(cos(t), sin(t)) {t < pi}', 'x^2 + y^2 = 4 {y > 0}', 'x^2 + y^2 < 4 {y > 0}', "y' = y {0 < t < 3}", 'f(x) = {x < 0: 0, x}']) {
      const { p, back } = roundTrip(raw);
      expect(back.kind, raw).toBe(p.kind);
      expect((back as { restrictions?: unknown[] }).restrictions?.length ?? 0).toBe(
        (p as { restrictions?: unknown[] }).restrictions?.length ?? 0,
      );
    }
    // No braces in ordinary rows; calls keep their call shape.
    expect(entryToLatex(parseEntry('y = sin(x)'))).not.toMatch(/\\\{/);
    expect(latexToText(entryToLatex(parseEntry('y = g(2) + y_1(3)'))!)).toMatch(/g\(2\)/);
  });

  it('reads typical MathLive output', () => {
    const fn = (tex: string) => as(parseEntry(latexToText(tex)), 'function');
    const a = fn('y=\\left\\lbrace x<0\\colon-x,x^2\\right\\rbrace');
    expect(at(a, -2)).toBe(2);
    expect(at(a, 3)).toBe(9);
    const b = fn('y=\\{x\\le0:-x,x^2\\}');
    expect(at(b, 0)).toBe(-0);
    expect(at(b, 2)).toBe(4);
    const c = fn('y=x^2\\left\\lbrace0<x<2\\right\\rbrace');
    expect(c.restrictions).toHaveLength(1);
    expect(at(c, 3)).toBeNaN();
    const d = fn('y=\\left\\lbrace-1\\le x\\le1\\right\\rbrace');
    expect(at(d, 0)).toBe(1);
    const e = fn('y=\\left\\lbrace x\\ge1\\text{ and }x\\le2:1,0\\right\\rbrace');
    expect([at(e, 0), at(e, 1.5)]).toEqual([0, 1]);
    const f = fn('y=\\left\\lbrace x\\ne1:1\\right\\rbrace');
    expect(at(f, 1)).toBeNaN();
  });

  it('the cases display of a ternary (old editor content) lands on the function path', () => {
    // What the editor showed for `y = t > 3 ? -t : t` before (mathjs' cases form).
    const old = 'y = \\begin{cases} {-{t}}, &\\quad{\\text{if }\\;{t}>3}\\\\{{t}}, &\\quad{\\text{otherwise}}\\end{cases}';
    const p = as(parseEntry(latexToText(old)), 'function');
    expect(at(p, 5)).toBe(-5);
    expect(at(p, 1)).toBe(1);
    // A hand-typed cases environment: value & condition rows.
    const typed = as(parseEntry(latexToText('y=\\begin{cases}-x & x<0\\\\ x^2 & \\text{otherwise}\\end{cases}')), 'function');
    expect([at(typed, -2), at(typed, 3)]).toEqual([2, 9]);
    const r = one(latexToText(old), {}, { tMin: -5, tMax: 10, yMin: -10, yMax: 10 });
    expect(r.curve.segments).toHaveLength(2);
  });
});

describe('piecewise: checkSpec', () => {
  it('summarises pieces and restrictions', () => {
    const r = checkSpec({
      expressions: [
        'y = {x < 0: -x, x^2}',
        'y = x^2 {0 < x < 2}',
        'r = θ {0 < θ < pi}',
        'x^2 + y^2 = 4 {y > 0}',
        'y = x < 0 ? -x : x^2',
        "y' = y {0 < t < 3}",
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.expressions.map((e) => [e.kind, e.summary])).toEqual([
      ['function', 'function y(x), piecewise (2 pieces)'],
      ['function', 'function y(x), restricted to 0 < x < 2'],
      ['polar', 'polar curve r(θ), restricted to 0 < θ < pi'],
      ['implicit', 'implicit curve F(x, y) = 0, restricted to y > 0'],
      ['function', 'function y(x), piecewise (2 pieces)'],
      ['ode', '1st-order ODE in y(t), restricted to 0 < t < 3'],
    ]);
  });
  it('reports a malformed brace as an error', () => {
    const r = checkSpec({ expressions: ['y = {x < 0: 1, 2, 3}'] });
    expect(r.ok).toBe(false);
  });
});
