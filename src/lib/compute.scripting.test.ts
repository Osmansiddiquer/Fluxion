import { beforeEach, describe, expect, it } from 'vitest';
import { computeAll, expandLoops, sampleParametric, MAX_COPIES, type CurveResult } from './compute';
import { parseEntry, type LoopSpec } from './math/parse';
import { compileNode } from './math/compileCache';
import { buildVarScope } from './math/resolveSlice';
import { encodeClip } from './frames/codec';
import { putAsset, _resetAssets } from './frames/assets';
import type { Entry, Viewport } from '../store/types';

const VP: Viewport = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: extra.id ?? `e${n++}`,
  raw,
  color: '#000000',
  visible: true,
  expanded: false,
  ...extra,
});
const run = (entries: Entry[], vp = VP) => computeAll(entries, vp, 400);
const pts = (r: CurveResult | undefined) => (r?.curve.segments ?? []).reduce((s, seg) => s + seg.length, 0);

describe('parametric curves', () => {
  it('samples a closed circle over the default 0…2π', () => {
    const e = E('(2cos(t), 2sin(t))');
    const r = run([e]).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(r.curve.segments).toHaveLength(1);
    const seg = r.curve.segments[0];
    expect(seg[0][0]).toBeCloseTo(2);
    expect(seg[seg.length - 1][0]).toBeCloseTo(2);
    expect(seg[seg.length - 1][1]).toBeCloseTo(0);
    for (const [x, y] of seg) expect(Math.hypot(x, y)).toBeCloseTo(2);
  });
  it('respects the t-range (thetaMin/thetaMax)', () => {
    const e = E('(t, t^2)', { thetaMin: 0, thetaMax: 1 });
    const seg = run([e]).get(e.id)!.curve.segments[0];
    expect(seg[0]).toEqual([0, 0]);
    expect(seg[seg.length - 1][0]).toBeCloseTo(1);
  });
  it('breaks where a coordinate is undefined', () => {
    const p = parseEntry('(t, sqrt(t))');
    if (p.kind !== 'parametric') throw new Error('expected parametric');
    const c = sampleParametric(compileNode(p.xNode), compileNode(p.yNode), {}, -1, 1);
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0][0][0]).toBeGreaterThanOrEqual(0);
  });
  it('uses variables and prompts for undefined ones', () => {
    const a = E('a = 3');
    const c = E('(a cos(t), sin(t))');
    expect(run([a, c]).get(c.id)!.curve.segments[0][0][0]).toBeCloseTo(3);
    const lone = E('(q cos(t), sin(t))');
    expect(run([lone]).get(lone.id)!.undefinedVars).toEqual(['q']);
  });
});

describe('derived values', () => {
  it('evaluates chains in dependency order regardless of entry order', () => {
    const c = E('c = b + 1');
    const b = E('b = 2a');
    const a = E('a = 3');
    const res = run([c, b, a]);
    expect(res.get(b.id)!.value).toBe(6);
    expect(res.get(c.id)!.value).toBe(7);
    expect(res.get(c.id)!.curve.segments).toHaveLength(0);
  });
  it('drives curves', () => {
    const a = E('a = 1', { varValue: 2 });
    const k = E('k = a^2');
    const f = E('y = k');
    const seg = run([a, k, f]).get(f.id)!.curve.segments[0];
    expect(seg[0][1]).toBe(4);
  });
  it('supports helpers and ternaries', () => {
    const T = E('T = 1.5');
    const m = E('m = T < 1 ? 0 : keys(T, 1, 0, 2, 10)');
    expect(run([T, m]).get(m.id)!.value).toBe(5);
  });
  it('reports cycles and duplicates', () => {
    const p = E('p = q + 1');
    const q = E('q = p + 1');
    const res = run([p, q]);
    expect(res.get(p.id)!.error).toBe('Circular definition');
    const a = E('a = 2');
    const a2 = E('a = 3b');
    const b = E('b = 1');
    expect(run([a, a2, b]).get(a2.id)!.error).toMatch(/already defined/);
  });
  it('prompts to define a missing input', () => {
    const d = E('d = 2z');
    expect(run([d]).get(d.id)!.undefinedVars).toEqual(['z']);
  });
  it('named functions of t still plot', () => {
    const f = E('f = sin(t)');
    expect(pts(run([f]).get(f.id))).toBeGreaterThan(10);
  });
  it('is visible to buildVarScope (slices, singularity detection)', () => {
    const scope = buildVarScope([E('a = 2'), E('b = a + 1'), E('f(u) = u * b')]);
    expect(scope.b).toBe(3);
    expect((scope.f as unknown as (u: number) => number)(2)).toBe(6);
    expect(typeof scope.lerp).toBe('function');
  });
});

describe('user functions', () => {
  it('are callable from functions, curves and other functions', () => {
    const a = E('a = 1');
    const sq = E('sq(u) = u^2 + a');
    const tw = E('tw(u) = 2 sq(u)');
    const y = E('y = tw(t)');
    const r = run([a, sq, tw, y]).get(y.id)!;
    expect(r.error).toBeUndefined();
    const seg = r.curve.segments[0];
    const [t0, y0] = seg[0];
    expect(y0).toBeCloseTo(2 * (t0 * t0 + 1));
  });
  it('defined after use still resolve', () => {
    const y = E('y = g(t)');
    const g = E('g(u) = 3u');
    expect(run([y, g]).get(y.id)!.curve.segments[0][0][1]).toBeCloseTo(-15);
  });
  it('a one-parameter f(x) is plotted; others are not', () => {
    const f = E('f(x) = x^2');
    const h = E('h(u, v) = u v');
    const res = run([f, h]);
    expect(pts(res.get(f.id))).toBeGreaterThan(10);
    expect(res.get(h.id)!.curve.segments).toHaveLength(0);
    expect(res.get(h.id)!.error).toBeUndefined();
  });
  it('wrong arity is an evaluation error (empty curve), not a crash', () => {
    const f = E('f(u, v) = u + v');
    const y = E('y = f(t)');
    const r = run([f, y]).get(y.id)!;
    expect(r.curve.segments).toHaveLength(0);
  });
  it('nested and repeated calls stay correct with the last-call memo', () => {
    const scope = buildVarScope([E('f(u) = u^2 + 1')]);
    const f = scope.f as unknown as (u: number) => number;
    expect(f(2)).toBe(5);
    expect(f(2)).toBe(5);
    expect(f(f(1))).toBe(5); // f(2) via f(1)
    expect(f(3)).toBe(10);
    const y = E('y = f(f(t)) - f(t)');
    const fd = E('f(u) = 2u');
    const seg = run([fd, y]).get(y.id)!.curve.segments[0];
    for (const [t, v] of seg) expect(v).toBeCloseTo(4 * t - 2 * t);
  });
  it('mutual recursion is stopped', () => {
    const f = E('f(u) = g(u)');
    const g = E('g(u) = f(u)');
    const y = E('y = f(t)');
    const r = run([f, g, y]).get(y.id)!;
    expect(r.curve.segments).toHaveLength(0);
  });
  it('duplicate definitions and unknown functions are reported', () => {
    const f1 = E('f(u) = u');
    const f2 = E('f(u) = 2u');
    expect(run([f1, f2]).get(f2.id)!.error).toMatch(/already defined/);
    const y = E('y = nope(t)');
    expect(run([y]).get(y.id)!.unknownFns).toEqual(['nope']);
  });
  it('body variables must be defined', () => {
    const f = E('f(u) = u + w');
    expect(run([f]).get(f.id)!.undefinedVars).toEqual(['w']);
  });
  it('can feed an ODE', () => {
    const f = E('f(u) = -u');
    const o = E("y' = f(y)", { t0: 0, ic: [1] });
    const seg = run([f, o]).get(o.id)!.curve.segments[0];
    const last = seg[seg.length - 1];
    expect(last[1]).toBeCloseTo(Math.exp(-last[0]), 2);
  });
});

describe('repeat', () => {
  it('draws a parametric body once per loop value', () => {
    const e = E('(cos(t) + 3k, sin(t)) for k = 0..2');
    const r = run([e]).get(e.id)!;
    expect(r.copies).toBe(3);
    expect(r.curve.segments).toHaveLength(3);
    expect(r.curve.segments[2][0][0]).toBeCloseTo(7);
  });
  it('repeats points (and they stay markers)', () => {
    const e = E('(k, k^2) for k = 1..4');
    const r = run([e]).get(e.id)!;
    expect(r.points).toEqual([
      [1, 1],
      [2, 4],
      [3, 9],
      [4, 16],
    ]);
  });
  it('repeats segments: ((x1,y1),(x2,y2)) per copy', () => {
    const e = E('((k, 0), (k, 1)) for k = 0..3');
    expect(run([e]).get(e.id)!.curve.segments).toHaveLength(4);
  });
  it('a repeated inequality is the union of regions', () => {
    const e = E('(t - 3k)^2 + y^2 < 1 for k = 0..1');
    const r = run([e]).get(e.id)!;
    expect(r.inequality!.test(0, 0)).toBe(true);
    expect(r.inequality!.test(3, 0)).toBe(true);
    expect(r.inequality!.test(1.5, 0)).toBe(false);
    expect(r.inequality!.boundaries.length).toBe(2);
  });
  it('loop bounds use variables and earlier loops', () => {
    const nv = E('n = 3');
    const e = E('(i, j) for i = 0..n, j = i..n');
    const r = run([nv, e]).get(e.id)!;
    expect(r.copies).toBe(4 + 3 + 2 + 1);
  });
  it('repeats functions and polar curves', () => {
    const f = E('y = k t for k = 1..3');
    const p = E('r = k for k = 1..2');
    const res = run([f, p]);
    expect(res.get(f.id)!.curve.segments).toHaveLength(3);
    expect(res.get(p.id)!.curve.segments).toHaveLength(2);
  });
  it('caps the number of copies', () => {
    const e = E('(k, 0) for k = 0..100000');
    expect(run([e]).get(e.id)!.error).toMatch(/Too many copies/);
    const loops: LoopSpec[] = (parseEntry('(i, j) for i = 0..100, j = 0..100') as { loops: LoopSpec[] }).loops;
    expect(() => expandLoops(loops, {})).toThrow(String(MAX_COPIES));
  });
  it('the loop variable is not reported as undefined', () => {
    const e = E('(k, a) for k = 0..2');
    expect(run([e]).get(e.id)!.undefinedVars).toEqual(['a']);
  });
});

describe('frames', () => {
  beforeEach(() => _resetAssets());
  const clip = encodeClip({
    w: 10,
    h: 10,
    fps: 10,
    box: [0, 0, 10, 10],
    frames: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ],
      [],
    ],
  });
  it('shows the indexed frame in data coordinates, even-odd filled', () => {
    const id = putAsset(clip);
    const T = E('i = 0');
    const f = E('frames(i)', { frames: id });
    const r = run([T, f]).get(f.id)!;
    expect(r.error).toBeUndefined();
    expect(r.fillRule).toBe('evenodd');
    expect(r.curve.segments).toHaveLength(1);
    // image y down → data y up; polygon is explicitly closed
    expect(r.curve.segments[0]).toEqual([
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 10],
    ]);
  });
  it('wraps the index and floors fractional frames', () => {
    const id = putAsset(clip);
    const f1 = E('frames(1.7)', { frames: id });
    const f2 = E('frames(2)', { frames: id });
    const res = run([f1, f2]);
    expect(res.get(f1.id)!.curve.segments).toHaveLength(0);
    expect(res.get(f2.id)!.curve.segments).toHaveLength(1);
  });
  it('errors without imported data', () => {
    const f = E('frames(0)');
    expect(run([f]).get(f.id)!.error).toMatch(/No frames/);
    const g = E('frames(0)', { frames: 'fxmissing' });
    expect(run([g]).get(g.id)!.error).toMatch(/not found/);
  });
});

describe('cache correctness', () => {
  it('a variable used inside a user function invalidates its callers', () => {
    const a = E('a = 1', { id: 'ca' });
    const f = E('f(u) = a u', { id: 'cf' });
    const y = E('y = f(t)', { id: 'cy' });
    const r1 = run([a, f, y]).get('cy')!;
    const r2 = run([{ ...a, varValue: 2 }, f, y]).get('cy')!;
    expect(r2).not.toBe(r1);
    expect(r2.curve.segments[0][0][1]).toBeCloseTo(2 * r1.curve.segments[0][0][1]);
  });
  it('editing a function definition invalidates its callers', () => {
    const f = E('f(u) = u', { id: 'df' });
    const y = E('y = f(t)', { id: 'dy' });
    const r1 = run([f, y]).get('dy')!;
    const r2 = run([{ ...f, raw: 'f(u) = 2u' }, y]).get('dy')!;
    expect(r2).not.toBe(r1);
  });
  it('a derived value change invalidates dependants', () => {
    const a = E('a = 1', { id: 'ga' });
    const b = E('b = 2a', { id: 'gb' });
    const y = E('(b cos(t), sin(t))', { id: 'gy' });
    const r1 = run([a, b, y]).get('gy')!;
    const r2 = run([{ ...a, varValue: 5 }, b, y]).get('gy')!;
    expect(r2).not.toBe(r1);
    expect(r2.curve.segments[0][0][0]).toBeCloseTo(10);
  });
  it('cosmetic and unrelated changes reuse the cached result', () => {
    const a = E('a = 1', { id: 'ha' });
    const z = E('z = 1', { id: 'hz' });
    const y = E('(a cos(t), sin(t)) for k = 0..1', { id: 'hy' });
    const r1 = run([a, z, y]).get('hy')!;
    const r2 = run([a, { ...z, varValue: 4 }, { ...y, color: '#ff0000', fill: true, lineWidth: 4, colorExpr: 'hsv(z,1,1)' }]).get('hy')!;
    expect(r2).toBe(r1);
  });
  it('the parametric range and the frames asset are part of the key', () => {
    const p = E('(t, 0)', { id: 'ip' });
    const r1 = run([p]).get('ip')!;
    const r2 = run([{ ...p, thetaMax: 1 }]).get('ip')!;
    expect(r2).not.toBe(r1);
    _resetAssets();
    const id1 = putAsset(encodeClip({ w: 1, h: 1, fps: 1, box: [0, 0, 1, 1], frames: [[]] }));
    const id2 = putAsset(
      encodeClip({ w: 1, h: 1, fps: 1, box: [0, 0, 1, 1], frames: [[[[0, 0], [1, 0], [1, 1]]]] }),
    );
    const f = E('frames(0)', { id: 'if', frames: id1 });
    const s1 = run([f]).get('if')!;
    const s2 = run([{ ...f, frames: id2 }]).get('if')!;
    expect(s2).not.toBe(s1);
    expect(s2.curve.segments).toHaveLength(1);
  });
  it('a loop-bound variable invalidates the repeat', () => {
    const nv = E('n = 1', { id: 'jn' });
    const r = E('(k, 0) for k = 0..n', { id: 'jr' });
    const r1 = run([nv, r]).get('jr')!;
    const r2 = run([{ ...nv, varValue: 3 }, r]).get('jr')!;
    expect(r1.copies).toBe(2);
    expect(r2.copies).toBe(4);
  });
});
