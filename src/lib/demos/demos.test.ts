import { describe, expect, it } from 'vitest';
import { DEMOS } from './index';
import { computeAll } from '../compute';
import { parseEntry } from '../math/parse';
import { isColorExpr } from '../color';
import { isGraph, makeGraph, parseGraphFile } from '../graphFile';
import { _resetAssets, registerAssets } from '../frames/assets';
import { buildSilhouetteClip, silhouetteFrame, CLIP_FRAMES, CLIP_W, CLIP_H } from './silhouette';
import { FrameSequence } from '../frames/codec';
import { insideEvenOdd } from '../frames/trace';
import type { Entry } from '../../store/types';

/** Set a variable's value (as the slider / clock would). */
function at(entries: Entry[], name: string, value: number): Entry[] {
  return entries.map((e) => {
    const p = parseEntry(e.raw);
    return p.kind === 'variable' && p.name === name ? { ...e, varValue: value } : e;
  });
}

describe.each(DEMOS.map((d) => [d.id, d] as const))('demo %s', (_id, demo) => {
  const g = demo.build();

  it('is a valid graph file and round-trips through JSON', () => {
    expect(isGraph(g)).toBe(true);
    const back = parseGraphFile(JSON.stringify(g));
    expect(back?.entries.length).toBe(g.entries.length);
  });

  it('every entry parses and computes without errors', () => {
    const res = computeAll(g.entries, g.viewport, 600);
    for (const e of g.entries) {
      const r = res.get(e.id)!;
      expect(r.parsed.kind, e.raw).not.toBe('error');
      expect(r.error, e.raw).toBeUndefined();
      expect(r.undefinedVars ?? [], e.raw).toEqual([]);
      expect(r.unknownFns ?? [], e.raw).toEqual([]);
    }
  });

  it('draws non-empty curves', () => {
    const res = computeAll(g.entries, g.viewport, 600);
    const drawn = g.entries.filter((e) => (res.get(e.id)?.curve.segments.length ?? 0) > 0);
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('colour expressions are valid', () => {
    for (const e of g.entries) {
      if (e.colorExpr) expect(isColorExpr(e.colorExpr), e.colorExpr).toBe(true);
      if (e.fillColor) expect(isColorExpr(e.fillColor), e.fillColor).toBe(true);
    }
  });

  it('has an auto-playing clock', () => {
    expect(g.entries.some((e) => e.autoplay && parseEntry(e.raw).kind === 'variable')).toBe(true);
  });

  it('fresh ids on every build', () => {
    const ids = new Set(g.entries.map((e) => e.id));
    expect(ids.size).toBe(g.entries.length);
    expect(demo.build().entries[0].id).not.toBe(g.entries[0].id);
  });
});

describe('sharingan', () => {
  const g = DEMOS.find((d) => d.id === 'sharingan')!.build();
  const tomoe = g.entries.find((e) => e.raw.includes('for k'))!;
  it('draws three closed tomoe that rotate with a', () => {
    const r0 = computeAll(g.entries, g.viewport, 600).get(tomoe.id)!;
    expect(r0.copies).toBe(3);
    expect(r0.curve.segments).toHaveLength(3);
    for (const seg of r0.curve.segments) {
      const [x0, y0] = seg[0];
      const [x1, y1] = seg[seg.length - 1];
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(1e-6); // closed outline
      // every point lies within the iris
      for (const [x, y] of seg) expect(Math.hypot(x, y)).toBeLessThan(2);
    }
    const r1 = computeAll(at(g.entries, 'a', 1), g.viewport, 600).get(tomoe.id)!;
    const ang = (r: typeof r0) => Math.atan2(r.curve.segments[0][0][1], r.curve.segments[0][0][0]);
    expect(Math.abs(ang(r1) - ang(r0))).toBeGreaterThan(0.5);
  });
  it('rotation by 2π/3 maps the pattern onto itself (seamless loop)', () => {
    const r0 = computeAll(g.entries, g.viewport, 600).get(tomoe.id)!;
    const r1 = computeAll(at(g.entries, 'a', (2 * Math.PI) / 3), g.viewport, 600).get(tomoe.id)!;
    const a = r0.curve.segments[1][0];
    const b = r1.curve.segments[0][0];
    expect(a[0]).toBeCloseTo(b[0]);
    expect(a[1]).toBeCloseTo(b[1]);
  });
});

describe('cube', () => {
  const g = DEMOS.find((d) => d.id === 'cube')!.build();
  const edges = g.entries.find((e) => e.raw.includes('for k = 0..11'))!;
  const verts = g.entries.find((e) => e.raw.includes('for i = 0..7'))!;
  it('has 12 edges and 8 vertices', () => {
    const res = computeAll(g.entries, g.viewport, 600);
    expect(res.get(edges.id)!.curve.segments).toHaveLength(12);
    expect(res.get(verts.id)!.points).toHaveLength(8);
  });
  it('edges have two lengths in projection only — in 3D all are equal', () => {
    // Orthographic, no rotation: the cube is a square of side 2·1.6.
    const flat = at(at(at(g.entries, 'a', 0), 'b', 0), 'd', 0);
    const res = computeAll(flat, g.viewport, 600);
    for (const [[x0, y0], [x1, y1]] of res.get(edges.id)!.curve.segments) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      expect([0, 3.2].some((L) => Math.abs(len - L) < 1e-9)).toBe(true);
    }
  });
  it('rotates', () => {
    const p0 = computeAll(g.entries, g.viewport, 600).get(verts.id)!.points!;
    const p1 = computeAll(at(g.entries, 'a', 1), g.viewport, 600).get(verts.id)!.points!;
    expect(p1[0][0]).not.toBeCloseTo(p0[0][0]);
  });
});

describe('mangekyō morph', () => {
  const g = DEMOS.find((d) => d.id === 'mangekyo')!.build();
  const shapes = g.entries.find((e) => e.raw.includes('for k'))!;
  const valueOf = (entries: Entry[], name: string) => {
    const res = computeAll(entries, g.viewport, 300);
    const e = entries.find((x) => x.raw.startsWith(`${name} =`))!;
    return res.get(e.id)!.value!;
  };
  it('keyframes run eye → sharingan → mangekyō → eye', () => {
    expect(valueOf(at(g.entries, 'T', 0), 'g')).toBe(0);
    expect(valueOf(at(g.entries, 'T', 5), 'g')).toBe(1);
    expect(valueOf(at(g.entries, 'T', 5), 'm')).toBe(0);
    expect(valueOf(at(g.entries, 'T', 8.5), 'm')).toBe(1);
    expect(valueOf(at(g.entries, 'T', 12), 'g')).toBe(0);
    expect(valueOf(at(g.entries, 'T', 12), 'c')).toBe(0);
  });
  it('the shapes reach out to the rim once morphed', () => {
    const reach = (T: number) => {
      const r = computeAll(at(g.entries, 'T', T), g.viewport, 300).get(shapes.id)!;
      return Math.max(...r.curve.segments.flat().map(([x, y]) => Math.hypot(x, y)));
    };
    expect(reach(5)).toBeLessThan(1.8); // tomoe sit on the ring
    expect(reach(8.5)).toBeGreaterThan(1.9); // blades touch the iris edge
  });
});

describe('silhouette clip', () => {
  it('is deterministic and reproduces its source frames', () => {
    const data = buildSilhouetteClip(CLIP_FRAMES);
    expect(buildSilhouetteClip(CLIP_FRAMES)).toBe(data);
    const seq = new FrameSequence(data);
    expect(seq.count).toBe(CLIP_FRAMES);
    for (const f of [0, 30, 60, 100, CLIP_FRAMES - 1]) {
      const src = silhouetteFrame(f);
      const polys = seq.frame(f);
      let wrong = 0;
      for (let j = 0; j < CLIP_H; j++)
        for (let i = 0; i < CLIP_W; i++) {
          if ((insideEvenOdd(polys, 2 * i + 1, 2 * j + 1) ? 1 : 0) !== src[j * CLIP_W + i]) wrong++;
        }
      // Simplification only nudges edge pixels.
      expect(wrong / (CLIP_W * CLIP_H)).toBeLessThan(0.02);
    }
  });
  it('stays small enough for a graph file', () => {
    expect(buildSilhouetteClip().length).toBeLessThan(150_000);
  });
  it('exports with its frames and plays after re-import into a fresh store', () => {
    const g = DEMOS.find((d) => d.id === 'silhouette')!.build();
    const exported = JSON.parse(JSON.stringify(makeGraph(g)));
    expect(Object.keys(exported.assets)).toHaveLength(1);
    _resetAssets();
    registerAssets(exported.assets);
    const frames = exported.entries.find((e: Entry) => e.frames)!;
    const r = computeAll(at(exported.entries, 'T', 1), exported.viewport, 300).get(frames.id)!;
    expect(r.error).toBeUndefined();
    expect(r.fillRule).toBe('evenodd');
    expect(r.curve.segments.length).toBeGreaterThan(0);
  });
});
