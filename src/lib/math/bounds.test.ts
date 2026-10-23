import { describe, expect, it } from 'vitest';
import { parse as mjParse } from 'mathjs';
import { boundsOf, boxOutside, parametricBox, polarBox, UNBOUNDED } from './bounds';
import { normalizeInput } from './normalize';
import { HELPERS } from './helpers';
import { computeAll, sampleParametric } from '../compute';
import { compileNode } from './compileCache';
import type { Entry, Viewport } from '../../store/types';

let seed = 11;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const EXPRS = [
  't', '-t', '2t + 1', 't^2', 't^3', 't^-1', 't^-2', '(t + 3)^0.5', 'sin(t)', 'cos(3t + 1)', 'sin(t)^2',
  'exp(t)', 'log(t + 10)', 'sqrt(abs(t))', 'abs(t - 1)', 'atan(t)', 'tanh(t)', 'sinh(t)', 'cosh(t)', 'floor(t)',
  'ceil(t)', 'round(t)', 'mod(t, 3)', 'mod(t*0.3 + 47.999999999, 48)', 'mod(-t, -2)', 't mod 1.5', 'min(t, 1)', 'max(t, -1, 2)',
  'hypot(t, 2)', 't > 0 ? t : -t', '1/(t + 20)', 'sign(t)', '(1 + 0.15*sin(3t + k))*cos(t)*a + mod(T*0.4 + k, 48) - 24',
  'cbrt(t)', 'log10(t + 11)', 'log2(t + 11)', 'asinh(t)', '2^t', '0.5^t', 'pi*t + e', 'k*a/(1 + t^2)',
];

describe('interval bounds enclose every sampled value', () => {
  for (const expr of EXPRS) {
    it(expr, () => {
      const node = mjParse(normalizeInput(expr));
      const ev = compileNode(node);
      for (let trial = 0; trial < 40; trial++) {
        const lo = (rnd() - 0.5) * 20;
        const hi = lo + rnd() * (trial % 4 === 0 ? 30 : 3);
        const scope = { k: Math.floor(rnd() * 5), a: rnd() * 3, T: rnd() * 60 };
        const [bl, bh] = boundsOf(node, scope, { t: [lo, hi] });
        for (let i = 0; i <= 200; i++) {
          const t = lo + ((hi - lo) * i) / 200;
          const v = ev.evaluate({ ...scope, t });
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          expect(v >= bl && v <= bh, `${expr} t=${t} v=${v} not in [${bl}, ${bh}]`).toBe(true);
        }
      }
    });
  }

  it('is unbounded for things it cannot reason about', () => {
    const helpers = { ...HELPERS } as Record<string, unknown>;
    expect(boundsOf(mjParse('lerp(0, 1, t)'), helpers, { t: [0, 1] })).toEqual(UNBOUNDED.map((x) => x));
    expect(boundsOf(mjParse('q + t'), {}, { t: [0, 1] })[1]).toBe(Infinity);
    expect(boundsOf(mjParse('1/t'), {}, { t: [-1, 1] })[1]).toBe(Infinity);
    expect(boundsOf(mjParse('sqrt(t)'), {}, { t: [-1, 1] })[1]).toBe(Infinity);
    expect(boundsOf(mjParse('[1,2][1] * t'), {}, { t: [0, 1] })[1]).toBe(Infinity);
    // A scope function shadowing a built-in name is not the built-in.
    expect(boundsOf(mjParse('sin(t)'), { sin: () => 5 }, { t: [0, 1] })[1]).toBe(Infinity);
  });

  it('boxes parametric and polar curves', () => {
    const b = parametricBox(mjParse('3cos(t) + 10'), mjParse('2sin(t)'), {}, 0, 2 * Math.PI);
    expect(b.x[0]).toBeCloseTo(7, 6);
    expect(b.x[1]).toBeCloseTo(13, 6);
    expect(b.y[1]).toBeCloseTo(2, 6);
    const p = polarBox(mjParse('1 + cos(theta)'), {}, 0, 2 * Math.PI);
    expect(p.x[1]).toBeCloseTo(2, 6);
    const vp = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
    expect(boxOutside(b, vp, 0)).toBe(false);
    expect(boxOutside({ x: [9, 12], y: [0, 1] }, vp, 0.5)).toBe(true);
    expect(boxOutside({ x: [9, 12], y: [0, 1] }, vp, 1.5)).toBe(false);
  });
});

describe('off-screen culling', () => {
  const vp: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
  const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
    id: `c${rnd()}`,
    raw,
    color: '#000',
    visible: true,
    expanded: false,
    ...extra,
  });

  it('never drops a shape with any point in view (randomised clouds)', () => {
    let culledSome = 0;
    for (let trial = 0; trial < 150; trial++) {
      const cx = ((rnd() - 0.5) * 50).toFixed(3);
      const cy = ((rnd() - 0.5) * 30).toFixed(3);
      const r = (0.2 + rnd() * 4).toFixed(3);
      const T = (rnd() * 100).toFixed(3);
      const raw = `(${r}*(1 + 0.2*sin(3t))*cos(t) + mod(${T}*0.7 + ${cx}, 48) - 24, ${r}*sin(t) + ${cy})`;
      const e = E(raw);
      const res = computeAll([e], vp, 1200).get(e.id)!;
      const node = res.parsed.kind === 'parametric' ? res.parsed : null;
      expect(node).not.toBeNull();
      const full = sampleParametric(compileNode(node!.xNode), compileNode(node!.yNode), {}, 0, 2 * Math.PI);
      const visible = full.segments.some((s) => s.some(([x, y]) => x >= vp.tMin && x <= vp.tMax && y >= vp.yMin && y <= vp.yMax));
      if (visible) expect(res.curve.segments.length, raw).toBeGreaterThan(0);
      if (res.culled) culledSome++;
    }
    expect(culledSome).toBeGreaterThan(10);
  });

  it('culls repeat copies individually and reports how many', () => {
    const e = E('(cos(t) + 6k, sin(t)) for k = -5..5');
    const res = computeAll([e], vp, 1200).get(e.id)!;
    expect(res.copies).toBe(11);
    // Copies k = ±2…±5 sit at |x| ≥ 11 (radius 1): 8 are off-screen, 3 drawn.
    expect(res.culled).toBe(8);
    expect(res.curve.segments.length).toBe(3);
  });

  it('keeps shapes on a layer (they move at draw time) and unbounded ones', () => {
    const a = E('(cos(t) + 30, sin(t))', { layer: 'far' });
    expect(computeAll([a], vp, 1200).get(a.id)!.curve.segments.length).toBeGreaterThan(0);
    const b = E('(lerp(30, 31, 0.5) + cos(t), sin(t))');
    expect(computeAll([b], vp, 1200).get(b.id)!.culled).toBeUndefined();
  });

  it('re-samples when the view pans onto a culled shape', () => {
    const e = E('(cos(t) + 20, sin(t))');
    expect(computeAll([e], vp, 1200).get(e.id)!.curve.segments.length).toBe(0);
    const moved = { tMin: 12, tMax: 28, yMin: -5, yMax: 5 };
    expect(computeAll([e], moved, 1200).get(e.id)!.curve.segments.length).toBeGreaterThan(0);
  });
});

describe('per-entry samples', () => {
  const vp: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
  const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
    id: `s${rnd()}`,
    raw,
    color: '#000',
    visible: true,
    expanded: false,
    ...extra,
  });
  const count = (r: { curve: { segments: unknown[][] } }) => r.curve.segments.reduce((n, s) => n + s.length, 0);

  it('overrides the resolution of parametric, polar and function curves', () => {
    const p = E('(cos(t), sin(t))', { samples: 64 });
    expect(count(computeAll([p], vp, 1200).get(p.id)!)).toBe(65);
    const q = E('r = 2', { samples: 900 });
    expect(count(computeAll([q], vp, 1200).get(q.id)!)).toBe(901);
    const f = E('y = sin(x)', { samples: 100 });
    expect(count(computeAll([f], vp, 1200).get(f.id)!)).toBe(101);
    const d = E('(cos(t), sin(t))');
    expect(count(computeAll([d], vp, 1200).get(d.id)!)).toBe(481); // default unchanged
  });

  it('applies to every copy of a repeat and is clamped', () => {
    const p = E('(cos(t) + k, sin(t)) for k = 0..2', { samples: 32 });
    expect(count(computeAll([p], vp, 1200).get(p.id)!)).toBe(3 * 33);
    const tiny = E('(cos(t), sin(t))', { samples: 1 });
    expect(count(computeAll([tiny], vp, 1200).get(tiny.id)!)).toBe(9);
  });

  it('is part of the cache key', () => {
    const p = E('(cos(t), sin(t))', { samples: 64 });
    const first = computeAll([p], vp, 1200).get(p.id)!;
    expect(computeAll([{ ...p }], vp, 1200).get(p.id)).toBe(first);
    const changed = computeAll([{ ...p, samples: 128 }], vp, 1200).get(p.id)!;
    expect(changed).not.toBe(first);
    expect(count(changed)).toBe(129);
  });
});
