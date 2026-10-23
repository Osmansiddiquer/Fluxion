import { describe, expect, it } from 'vitest';
import { computeAll } from './compute';
import { resolveStyle, canFillShape, dashFor, DEFAULT_LINE_WIDTH } from './style';
import { rasterizeRegion } from './raster';
import { HELPERS } from './math/helpers';
import type { Entry } from '../store/types';

let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `s${n++}`,
  raw,
  color: '#c74440',
  visible: true,
  expanded: false,
  ...extra,
});
const VP = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
const resOf = (e: Entry, others: Entry[] = []) => computeAll([...others, e], VP, 200).get(e.id)!;

describe('resolveStyle defaults', () => {
  it('plain curves: solid stroke, no fill', () => {
    const e = E('y = t');
    const s = resolveStyle(e, resOf(e), {});
    expect(s.stroke).toBe('rgba(199, 68, 64, 1)');
    expect(s.lineWidth).toBe(DEFAULT_LINE_WIDTH);
    expect(s.fill).toBeNull();
    expect(s.dash).toEqual([]);
  });
  it('inequalities shade their region by default', () => {
    const e = E('y < t');
    const s = resolveStyle(e, resOf(e), {});
    expect(s.fillMode).toBe('region');
    expect(s.fill).toBe('rgba(199, 68, 64, 0.16)');
    const off = resolveStyle({ ...e, fill: false }, resOf(e), {});
    expect(off.fill).toBeNull();
  });
  it('closed shapes fill only when asked', () => {
    const e = E('(cos(t), sin(t))');
    const r = resOf(e);
    expect(resolveStyle(e, r, {}).fill).toBeNull();
    const s = resolveStyle({ ...e, fill: true }, r, {});
    expect(s.fillMode).toBe('shape');
    expect(s.fill).toBe('rgba(199, 68, 64, 0.4)');
    expect(resolveStyle({ ...e, fill: true, fillOpacity: 1 }, r, {}).fill).toBe('rgba(199, 68, 64, 1)');
  });
  it('plain functions and implicit curves are never shape-filled', () => {
    const f = E('y = t^2', { fill: true });
    expect(resolveStyle(f, resOf(f), {}).fill).toBeNull();
    const imp = E('t^2 + y^2 = 4', { fill: true });
    expect(resolveStyle(imp, resOf(imp), {}).fill).toBeNull();
  });
  it('polygons and repeated shapes can fill', () => {
    const poly = E('((0,0),(1,0),(0,1))');
    expect(canFillShape(resOf(poly))).toBe(true);
    const rep = E('(cos(t) + k, sin(t)) for k = 0..1');
    expect(canFillShape(resOf(rep))).toBe(true);
    const dot = E('(1, 2)');
    expect(canFillShape(resOf(dot))).toBe(false);
  });
  it('line width 0 hides the stroke; styles map to dashes', () => {
    const e = E('y = t', { lineWidth: 0 });
    expect(resolveStyle(e, resOf(e), {}).stroke).toBeNull();
    expect(dashFor('solid', 2)).toEqual([]);
    expect(dashFor('dashed', 2)).toEqual([7, 5]);
    expect(dashFor('dotted', 2)[0]).toBeLessThan(0.1);
    const d = E('y = t', { lineStyle: 'dashed', lineWidth: 4 });
    expect(resolveStyle(d, resOf(d), {}).dash).toEqual([14, 10]);
  });
});

describe('resolveStyle colour expressions', () => {
  it('colorExpr overrides the static colour and can animate', () => {
    const e = E('y = t', { colorExpr: 'rgb(255 a, 0, 0)' });
    expect(resolveStyle(e, resOf(e), { a: 1 }).stroke).toBe('rgba(255, 0, 0, 1)');
    expect(resolveStyle(e, resOf(e), { a: 0 }).stroke).toBe('rgba(0, 0, 0, 1)');
  });
  it('an invalid expression falls back to the static colour', () => {
    const e = E('y = t', { colorExpr: 'rgb(' });
    expect(resolveStyle(e, resOf(e), {}).stroke).toBe('rgba(199, 68, 64, 1)');
  });
  it('alpha 0 hides; alpha multiplies with fill opacity', () => {
    const e = E('(cos(t), sin(t))', { colorExpr: 'rgba(0,0,0,0)', fill: true });
    const s = resolveStyle(e, resOf(e), {});
    expect(s.stroke).toBeNull();
    expect(s.fill).toBeNull();
    const h = E('(cos(t), sin(t))', { colorExpr: 'rgba(0,0,0,0.5)', fill: true, fillOpacity: 0.5 });
    expect(resolveStyle(h, resOf(h), {}).fill).toBe('rgba(0, 0, 0, 0.25)');
  });
  it('a separate fill colour (literal or expression)', () => {
    const e = E('(cos(t), sin(t))', { fill: true, fillOpacity: 1, fillColor: '#ffffff' });
    const s = resolveStyle(e, resOf(e), {});
    expect(s.fill).toBe('rgba(255, 255, 255, 1)');
    expect(s.stroke).toBe('rgba(199, 68, 64, 1)');
    const x = E('(cos(t), sin(t))', { fill: true, fillOpacity: 1, fillColor: 'hsv(0, 1, keys(T, 0, 0, 1, 1))' });
    expect(resolveStyle(x, resOf(x), { ...HELPERS, T: 1 }).fill).toBe('rgba(255, 0, 0, 1)');
  });
  it('the solid colour drops alpha (for markers)', () => {
    const e = E('y = t', { colorExpr: 'rgba(10, 20, 30, 0.2)' });
    expect(resolveStyle(e, resOf(e), {}).solid).toBe('rgba(10, 20, 30, 1)');
  });
});

describe('rasterizeRegion', () => {
  const ident = (p: number) => p;
  const area = (rects: { w: number; h: number }[]) => rects.reduce((s, r) => s + r.w * r.h, 0);
  it('fills everything / nothing', () => {
    expect(area(rasterizeRegion(() => true, 100, 60, ident, ident))).toBe(6000);
    expect(rasterizeRegion(() => false, 100, 60, ident, ident)).toEqual([]);
  });
  it('half-plane: area exact to the fine step and merged into few rects', () => {
    const rects = rasterizeRegion((x) => x < 37, 100, 64, ident, ident, 8, 2);
    expect(Math.abs(area(rects) - 37 * 64)).toBeLessThanOrEqual(2 * 64);
    expect(rects.length).toBeLessThanOrEqual(8);
  });
  it('disc area within a few percent and covered by non-overlapping rects', () => {
    const R = 30;
    const rects = rasterizeRegion((x, y) => (x - 50) ** 2 + (y - 50) ** 2 < R * R, 100, 100, ident, ident);
    expect(area(rects) / (Math.PI * R * R)).toBeGreaterThan(0.96);
    expect(area(rects) / (Math.PI * R * R)).toBeLessThan(1.04);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(100);
      expect(r.y + r.h).toBeLessThanOrEqual(100);
    }
  });
  it('handles sizes that are not multiples of the step and throwing tests', () => {
    expect(area(rasterizeRegion(() => true, 13, 7, ident, ident))).toBe(91);
    expect(
      rasterizeRegion(
        () => {
          throw new Error('x');
        },
        10,
        10,
        ident,
        ident,
      ),
    ).toEqual([]);
  });
  it('maps pixels through the inverse transform', () => {
    // data x = px / 10: region x < 5 → left half
    const rects = rasterizeRegion((x) => x < 5, 100, 10, (p) => p / 10, (p) => p);
    expect(Math.abs(area(rects) - 500)).toBeLessThanOrEqual(20);
  });
});
