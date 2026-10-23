import { describe, expect, it } from 'vitest';
import { applyMat, invertMat, layerMatrix, letterboxRect, mulMat } from './canvas';
import { CAMERA, drawOrder, evalLayers } from './layers';
import { evalPaint, isColorExpr, paintSolid, COLOR_FUNCTION_NAMES } from '../color';
import { resolveCopyStyles, resolveStyle, BLEND_OPS } from '../style';
import { computeAll } from '../compute';
import { buildVarScope } from '../math/resolveSlice';
import { parseEntry } from '../math/parse';
import { HELPERS } from '../math/helpers';
import type { Entry, Viewport } from '../../store/types';

const vp: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `r${n++}`,
  raw,
  color: '#2d70b3',
  visible: true,
  expanded: false,
  ...extra,
});

describe('gradients (colour expressions → Script mode Paint data)', () => {
  it('linear with evenly spaced colours, and with offset/colour pairs', () => {
    const p = evalPaint('linear(0, 9, 0, -9, #000000, #ffffff)', {});
    expect(p).toEqual({
      type: 'linear', x0: 0, y0: 9, x1: 0, y1: -9,
      stops: [{ offset: 0, color: 'rgba(0, 0, 0, 1)' }, { offset: 1, color: 'rgba(255, 255, 255, 1)' }],
    });
    const q = evalPaint('linear(0, 0, 1, 0, 0, #ff0000, 0.7, #00ff00, 1, #0000ff)', {}, 0.5);
    expect(q && typeof q !== 'string' && q.stops.map((s) => [s.offset, s.color])).toEqual([
      [0, 'rgba(255, 0, 0, 0.5)'],
      [0.7, 'rgba(0, 255, 0, 0.5)'],
      [1, 'rgba(0, 0, 255, 0.5)'],
    ]);
  });
  it('radial from the centre, driven by sliders and loop variables', () => {
    const p = evalPaint('radial(a, 1, 2k, rgba(255, 240, 200, 1), rgba(255, 170, 80, 0))', { a: 3, k: 2 });
    expect(p).toMatchObject({ type: 'radial', x0: 3, y0: 1, r0: 0, x1: 3, y1: 1, r1: 4 });
    expect(paintSolid(p)).toBe('rgba(255, 240, 200, 1)');
  });
  it('rejects malformed gradients and keeps plain colours plain', () => {
    expect(evalPaint('linear(0, 0, 1)', {})).toBeNull();
    expect(evalPaint('linear(0, 0, 1, 1, 2)', {})).toBeNull();
    expect(evalPaint('radial(0, 0, q, #fff)', {})).toBeNull();
    expect(evalPaint('hsv(0, 1, 1)', {})).toBe('rgba(255, 0, 0, 1)');
    expect(isColorExpr('linear(0, 0, 1, 1, #fff, #000)')).toBe(true);
    expect(COLOR_FUNCTION_NAMES).toEqual(expect.arrayContaining(['linear', 'radial']));
  });
});

describe('resolveStyle', () => {
  it('defaults are unchanged: solid strings, no effects', () => {
    const e = E('(cos(t), sin(t))', { fill: true });
    const res = computeAll([e], vp, 400).get(e.id);
    const st = resolveStyle(e, res, {});
    expect(st.stroke).toBe('rgba(45, 112, 179, 1)');
    expect(st.fill).toBe('rgba(45, 112, 179, 0.4)');
    expect(st).toMatchObject({ blend: null, glow: 0, glowColor: null, blur: 0, lineWidth: 2.25 });
  });
  it('gradient fills, blend, glow and blur (clamped)', () => {
    const e = E('(cos(t), sin(t))', {
      fill: true, fillOpacity: 1, fillColor: 'linear(0, 1, 0, -1, #ff0000, #0000ff)', blend: 'add', glow: 80, blur: 3,
    });
    const st = resolveStyle(e, computeAll([e], vp, 400).get(e.id), {});
    expect(st.fill).toMatchObject({ type: 'linear' });
    expect(st.blend).toBe(BLEND_OPS.add);
    expect(st.blend).toBe('lighter');
    expect(st.glow).toBe(50);
    expect(st.glowColor).toBe('rgba(45, 112, 179, 1)');
    expect(st.blur).toBe(3);
  });
  it('a transparent fill colour still means no fill', () => {
    const e = E('(cos(t), sin(t))', { fill: true, fillColor: 'transparent' });
    expect(resolveStyle(e, computeAll([e], vp, 400).get(e.id), {}).fill).toBeNull();
  });
});

describe('per-copy colours (k in colorExpr / fillColor)', () => {
  it('resolves one style per copy with that copy’s loop values', () => {
    const e = E('((-8, k - 5), (8, k - 5), (8, k - 4), (-8, k - 4)) for k = 0..3', {
      fill: true, fillOpacity: 1, lineWidth: 0, fillColor: 'rgb(60k, 0, 0)',
    });
    const res = computeAll([e], vp, 400).get(e.id)!;
    expect(res.copyRanges).toHaveLength(4);
    expect(res.copyRanges![2]).toMatchObject({ seg: [2, 3], vars: { k: 2 } });
    const per = resolveCopyStyles(e, res, buildVarScope([e]));
    expect(per?.map((s) => s.fill)).toEqual([0, 60, 120, 180].map((r) => `rgba(${r}, 0, 0, 1)`));
  });
  it('and gradients per copy; null when colours don’t use the loop variable', () => {
    const e = E('(cos(t) + k, sin(t)) for k = 0..1', { fill: true, fillColor: 'radial(k, 0, 1, #fff, #000)' });
    const res = computeAll([e], vp, 400).get(e.id)!;
    expect(resolveCopyStyles(e, res, {})?.map((s) => (s.fill as { x0: number }).x0)).toEqual([0, 1]);
    const plain = E('(cos(t) + k, sin(t)) for k = 0..1', { colorExpr: 'hsv(a, 1, 1)' });
    expect(resolveCopyStyles(plain, computeAll([plain], vp, 400).get(plain.id), { a: 1 })).toBeNull();
  });
  it('global colour expressions keep working on repeats (no k)', () => {
    const e = E('(cos(t) + k, sin(t)) for k = 0..1', { colorExpr: 'rgb(255, 0, 0)' });
    expect(resolveStyle(e, computeAll([e], vp, 400).get(e.id), {}).stroke).toBe('rgba(255, 0, 0, 1)');
  });
});

describe('layers', () => {
  it('layerMatrix: move, scale and rotate about a pivot', () => {
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
    expect(applyMat(layerMatrix(2, -1), 1, 1)).toEqual([3, 0]);
    expect(near(applyMat(layerMatrix(0, 0, 2, 0, 1, 1), 2, 1), [3, 1])).toBe(true);
    expect(near(applyMat(layerMatrix(0, 0, 1, Math.PI / 2, 1, 0), 2, 0), [1, 1])).toBe(true);
    const m = layerMatrix(1, 2, 3, 0.4, -1, 5);
    expect(near(applyMat(mulMat(invertMat(m)!, m), 0.3, -0.7), [0.3, -0.7])).toBe(true);
  });

  it('parse as their own kind with slider-driven arguments', () => {
    const p = parseEntry('far = layer(-0.2T, 0, 1.5, a, 1, 2)');
    expect(p.kind === 'layer' && p.name).toBe('far');
    expect(p.kind === 'layer' && p.deps.sort()).toEqual(['T', 'a']);
    const err = (raw: string) => {
      const q = parseEntry(raw);
      return q.kind === 'error' ? q.message : q.kind;
    };
    expect(err('far = layer(1)')).toMatch(/layer\(dx, dy\)/);
    expect(err('far = layer(t, 0)')).toMatch(/not with t/);
    expect(err('pi = layer(0, 0)')).toMatch(/can't be called/);
  });

  it('evaluate per frame and order members at the layer row (z-order)', () => {
    const T = E('T = 2');
    const a = E('(cos(t), sin(t))', { layer: 'far' });
    const b = E('(cos(t) + 1, sin(t))');
    const far = E('far = layer(-0.5T, 1)');
    const c = E('(cos(t) - 1, sin(t))', { layer: 'far' });
    const d = E('(cos(t) - 2, sin(t))', { layer: 'nope' });
    const entries = [T, a, b, far, c, d];
    const results = computeAll(entries, vp, 400);
    expect(results.get(far.id)!.error).toBeUndefined();
    const layers = evalLayers(entries, results, { ...HELPERS, ...buildVarScope(entries) });
    expect(layers.get('far')).toMatchObject({ index: 3, mat: [1, 0, -0, 1, -1, 1] });
    const order = drawOrder(entries, layers);
    expect(order.map((o) => o.entry.id)).toEqual([T.id, b.id, far.id, a.id, c.id, d.id]);
    expect(order.find((o) => o.entry.id === a.id)!.mat).toEqual(layers.get('far')!.mat);
    expect(order.find((o) => o.entry.id === d.id)!.mat).toBeNull(); // unknown layer: in place, untransformed
  });

  it('a camera layer moves everything (composed after an entry’s own layer)', () => {
    const cam = E('camera = layer(1, 0)');
    const far = E('far = layer(0, 1)');
    const a = E('(cos(t), sin(t))', { layer: 'far' });
    const b = E('(cos(t), sin(t))');
    const entries = [cam, far, a, b];
    const layers = evalLayers(entries, computeAll(entries, vp, 400), {});
    const order = drawOrder(entries, layers);
    expect(applyMat(order.find((o) => o.entry.id === a.id)!.mat!, 0, 0)).toEqual([1, 1]);
    expect(applyMat(order.find((o) => o.entry.id === b.id)!.mat!, 0, 0)).toEqual([1, 0]);
    expect(CAMERA).toBe('camera');
  });

  it('bad layer values fall back to identity with an error; unknown calls are not evaluated', () => {
    const L1 = E('w = layer(q, 0)');
    const L2 = E('v = layer(evil(1), 0)');
    const entries = [L1, L2];
    const layers = evalLayers(entries, computeAll(entries, vp, 400), {});
    expect(layers.get('w')).toMatchObject({ mat: [1, 0, 0, 1, 0, 0] });
    expect(layers.get('w')!.error).toBeTruthy();
    expect(layers.get('v')!.error).toMatch(/Unknown function/);
  });
});

describe('letterbox', () => {
  it('fits the largest frame of the aspect, centred', () => {
    expect(letterboxRect(1000, 600, undefined)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
    expect(letterboxRect(1000, 600, 2.5)).toEqual({ x: 0, y: 100, w: 1000, h: 400 });
    expect(letterboxRect(1000, 200, 2.5)).toEqual({ x: 250, y: 0, w: 500, h: 200 });
  });
});
