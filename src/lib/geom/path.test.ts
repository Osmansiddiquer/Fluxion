import { describe, expect, it } from 'vitest';
import { PathBuilder, catmullRomControls, flattenOps, type Pt } from './path';
import { OP } from '../script/protocol';
import { parseEntry } from '../math/parse';
import { computeAll } from '../compute';
import { showsVertexDots } from '../style';
import type { Entry, Viewport } from '../../store/types';

const near = (a: Pt, b: Pt, eps = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
const vp: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `p${n++}`,
  raw,
  color: '#000',
  visible: true,
  expanded: false,
  ...extra,
});

describe('path geometry', () => {
  it('a spline passes through every point, with C1 joins', () => {
    const pts: Pt[] = [[0, 0], [1, 2], [3, 1], [4, 3], [6, 0]];
    const b = new PathBuilder();
    b.splineThrough(pts);
    const poly = flattenOps(b.ops, 0.01)[0];
    for (const p of pts) expect(poly.some((q) => near(p, q))).toBe(true);
    // Tangent continuity: at each interior point the incoming c2 and outgoing c1
    // are collinear with it.
    const cubics: number[][] = [];
    for (let i = 0; i < b.ops.length; ) {
      if (b.ops[i] === OP.cubic) cubics.push(b.ops.slice(i + 1, i + 7));
      i += b.ops[i] === OP.cubic ? 7 : b.ops[i] === OP.move ? 3 : 1;
    }
    expect(cubics).toHaveLength(4);
    for (let k = 0; k < 3; k++) {
      const p: Pt = [cubics[k][4], cubics[k][5]];
      const inV = [p[0] - cubics[k][2], p[1] - cubics[k][3]];
      const outV = [cubics[k + 1][0] - p[0], cubics[k + 1][1] - p[1]];
      expect(Math.abs(inV[0] * outV[1] - inV[1] * outV[0])).toBeLessThan(1e-9);
      expect(inV[0] * outV[0] + inV[1] * outV[1]).toBeGreaterThan(0);
    }
  });

  it('a closed spline (last point = first) is smooth across the seam', () => {
    const pts: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];
    const b = new PathBuilder();
    b.splineThrough(pts, { closed: true });
    const c: number[][] = [];
    for (let i = 0; i < b.ops.length; ) {
      if (b.ops[i] === OP.cubic) c.push(b.ops.slice(i + 1, i + 7));
      i += b.ops[i] === OP.cubic ? 7 : 3;
    }
    const last = c[c.length - 1];
    const inV = [1 - last[2], 0 - last[3]];
    const outV = [c[0][0] - 1, c[0][1] - 0];
    expect(Math.abs(inV[0] * outV[1] - inV[1] * outV[0])).toBeLessThan(1e-9);
    // A symmetric loop through the unit-circle points stays close to the circle.
    for (const p of flattenOps(b.ops, 0.01)[0]) expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(0.12);
  });

  it('centripetal controls stay inside a very uneven span (no overshoot loops)', () => {
    const [c1, c2] = catmullRomControls([0, 0], [10, 0], [10.1, 0.1], [20, 0]);
    expect(c1[0]).toBeGreaterThan(9.9);
    expect(c2[0]).toBeLessThan(10.2);
  });

  it('arcs lie on their circle and end at the right angle', () => {
    const b = new PathBuilder();
    b.moveTo([2, 0]);
    b.arcAround([0, 0], Math.PI * 1.5);
    const poly = flattenOps(b.ops, 0.001)[0];
    for (const p of poly) expect(Math.abs(Math.hypot(p[0], p[1]) - 2)).toBeLessThan(2e-3);
    expect(near(poly[poly.length - 1], [0, -2], 1e-9)).toBe(true);
    const cw = new PathBuilder();
    cw.moveTo([1, 0]);
    cw.arcAround([0, 0], -Math.PI / 2);
    expect(near(cw.cur!, [0, -1], 1e-12)).toBe(true);
  });

  it('bezier pieces start at the previous point and end at the last', () => {
    const b = new PathBuilder();
    b.moveTo([0, 0]);
    b.cubicTo([1, 2], [3, 2], [4, 0]);
    b.quadTo([5, 2], [6, 0]);
    const poly = flattenOps(b.ops, 0.01, 10)[0];
    expect(poly).toHaveLength(21);
    expect(near(poly[10], [4, 0])).toBe(true);
    expect(near(poly[20], [6, 0])).toBe(true);
    expect(poly[5][1]).toBeCloseTo(1.5, 9); // cubic midpoint height = 3/4 · 2
  });
});

describe('spline / bezier / arc syntax', () => {
  it('parses as a smooth points path', () => {
    const a = parseEntry('spline((0, 0), (1, 2), (3, 1))');
    expect(a.kind === 'points' && a.smooth && a.polyline).toBe(true);
    const b = parseEntry('((0, 0), (1, 3), spline((2, 4), (3, 3.5)), bezier((5, -1), (2, -1), (0, 0)))');
    expect(b.kind === 'points' && b.smooth).toBe(true);
    const c = parseEntry('((2, 0), arc((0, 0), pi), (-2, -1))');
    expect(c.kind === 'points' && c.smooth).toBe(true);
    const d = parseEntry('((0, 0), spline((a, 1), (2, b)))');
    expect(d.kind === 'points' && d.deps.sort()).toEqual(['a', 'b']);
    // Plain polylines are unchanged.
    const e = parseEntry('((0, 0), (1, 1))');
    expect(e.kind === 'points' && e.smooth).toBeFalsy();
  });

  it('reports misuse', () => {
    const msg = (raw: string) => {
      const p = parseEntry(raw);
      return p.kind === 'error' ? p.message : `parsed as ${p.kind}`;
    };
    expect(msg('((0,0), arc((0,0)))')).toMatch(/arc needs/);
    expect(msg('((0,0), bezier((1,1)))')).toMatch(/bezier needs/);
    expect(msg('(bezier((1,1),(2,2)), (3,3))')).toMatch(/must start with a point/);
    expect(msg('arc((0,0), 1)')).toMatch(/inside a path/);
  });

  it('computes a flattened smooth curve with corners kept exact', () => {
    const e = E('((0, 0), (1, 3), spline((2, 4), (3, 3.5), (4, 4)), (5, 0), bezier((5, -1), (2, -1), (0, 0)))');
    const r = computeAll([e], vp, 1200).get(e.id)!;
    expect(r.error).toBeUndefined();
    expect(r.curve.segments).toHaveLength(1);
    const poly = r.curve.segments[0];
    expect(poly.length).toBeGreaterThan(20);
    for (const corner of [[0, 0], [1, 3], [4, 4], [5, 0]] as Pt[]) expect(poly.some((q) => near(corner, q, 1e-9))).toBe(true);
    expect(near(poly[poly.length - 1], [0, 0])).toBe(true);
    expect(r.path?.[0]).toBe(OP.move);
  });

  it('follows sliders, repeats per copy and respects per-entry samples', () => {
    const a = E('a = 2');
    const e = E('spline((0, 0), (1, a), (2, 0))');
    expect(computeAll([a, e], vp, 1200).get(e.id)!.curve.segments[0].some((p) => near(p, [1, 2]))).toBe(true);
    const r = E('spline((k, 0), (k + 1, 1), (k + 2, 0)) for k = 0..2');
    expect(computeAll([r], vp, 1200).get(r.id)!.curve.segments).toHaveLength(3);
    const s = E('spline((0, 0), (1, 1), (2, 0))', { samples: 10 });
    expect(computeAll([s], vp, 1200).get(s.id)!.curve.segments[0]).toHaveLength(21);
  });

  it('a closed spline fills as a smooth blob', () => {
    const e = E('spline((1, 0), (0, 1), (-1, 0), (0, -1), (1, 0))', { fill: true });
    const r = computeAll([e], vp, 1200).get(e.id)!;
    const poly = r.curve.segments[0];
    expect(near(poly[0], poly[poly.length - 1])).toBe(true);
  });
});

describe('vertex dots', () => {
  const dots = (raw: string, extra: Partial<Entry> = {}, fill: 'shape' | null = null) => {
    const e = E(raw, extra);
    return showsVertexDots(e, computeAll([e], vp, 1200).get(e.id), fill);
  };
  it('keep the defaults: points and plain polylines show dots; filled, repeated and smooth paths do not', () => {
    expect(dots('(1, 2)')).toBe(true);
    expect(dots('[(0, 0), (1, 1)]')).toBe(true);
    expect(dots('((0, 0), (1, 1), (2, 0))')).toBe(true);
    expect(dots('((0, 0), (1, 1), (2, 0))', {}, 'shape')).toBe(false);
    expect(dots('((k, 0), (k, 1)) for k = 0..2')).toBe(false);
    expect(dots('(k, k^2) for k = 0..2')).toBe(true);
    expect(dots('spline((0, 0), (1, 1), (2, 0))')).toBe(false);
  });
  it('the dots option overrides for polylines only', () => {
    expect(dots('((0, 0), (1, 1), (2, 0))', { dots: false })).toBe(false);
    expect(dots('((k, 0), (k, 1)) for k = 0..2', { dots: true })).toBe(true);
    expect(dots('spline((0, 0), (1, 1), (2, 0))', { dots: true })).toBe(true);
    expect(dots('(1, 2)', { dots: false })).toBe(true);
  });
});
