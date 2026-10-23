import { describe, expect, it } from 'vitest';
import { DEMOS } from './index';
import { runHeadless } from '../script/testkit';
import { computeAll } from '../compute';
import { getFrameSequence, registerAssets } from '../frames/assets';
import { isGraph, makeGraph, parseGraphFile } from '../graphFile';
import { sanitizeGraph } from '../api/load';
import type { ClipMeta } from '../script/protocol';
import type { GraphData } from '../graphFile';

function clipsOf(g: GraphData): ClipMeta[] {
  registerAssets(g.assets);
  return Object.entries(g.script?.clips ?? {}).map(([name, id]) => {
    const seq = getFrameSequence(id);
    if (seq instanceof Error) throw seq;
    return { name, id, frames: seq.count, fps: seq.header.fps, box: seq.header.box };
  });
}

const run = (g: GraphData, time: number) =>
  runHeadless(g.script!.code, {
    time,
    entries: g.entries.map((e) => ({ raw: e.raw, visible: e.visible, t0: e.t0, ic: e.ic, varValue: e.varValue })),
    clips: clipsOf(g),
    view: { xmin: g.viewport.tMin, xmax: g.viewport.tMax, ymin: g.viewport.yMin, ymax: g.viewport.yMax },
  });

describe.each(DEMOS.map((d) => [d.id, d] as const))('example %s', (_id, demo) => {
  const g = demo.build();

  it('is a script graph that survives a file / link round-trip', () => {
    expect(isGraph(g)).toBe(true);
    expect(g.script?.code.trim()).toBeTruthy();
    const back = sanitizeGraph(parseGraphFile(JSON.stringify(makeGraph({ ...g })))!);
    expect(back.script?.code).toBe(g.script!.code);
  });

  it('is short and readable (no ternary soup)', () => {
    const lines = g.script!.code.split('\n');
    expect(lines.length).toBeLessThan(70);
    for (const l of lines) expect((l.match(/\?/g) ?? []).length, l).toBeLessThanOrEqual(2);
    expect(g.script!.code).toMatch(/^\/\/ /); // starts with a comment saying what it is
  });

  it.each([0, 0.5, 2.25, 6.8, 11.9])('runs without errors and draws at t = %s', (t) => {
    const r = run(g, t);
    expect(r.error, r.error?.message).toBeUndefined();
    expect(r.frame.items.length).toBeGreaterThan(0);
    expect(r.frame.animated).toBe(true);
    expect(r.frame.ms).toBeLessThan(1500); // generous: CI machines are slow; the app shows real timings
  });

  it('its Graph-mode expressions (if any) compute cleanly', () => {
    const res = computeAll(g.entries, g.viewport, 400);
    for (const e of g.entries) {
      const r = res.get(e.id)!;
      expect(r.error, e.raw).toBeUndefined();
      expect(r.parsed.kind, e.raw).not.toBe('error');
    }
  });
});

describe('specific examples', () => {
  const byId = (id: string) => DEMOS.find((d) => d.id === id)!.build();
  it('sharingan draws three tomoe with a named helper', () => {
    const g = byId('sharingan');
    expect(g.script!.code).toMatch(/function tomoe\(/);
    const r = run(g, 1);
    // iris, glow, ring, pupil, 3 tomoe, highlight
    expect(r.frame.items).toHaveLength(8);
    expect(r.frame.loop).toBe(4);
  });
  it('pendulum follows the Graph-mode ODE solution', () => {
    const g = byId('pendulum');
    expect(g.entries[0].raw).toMatch(/theta''/);
    const at = (t: number) => run(g, t).frame.items.find((i) => i.k === 'point')!;
    // The dot rides the solution curve: (t, θ(t)); θ(0) = 2.2.
    expect(at(0)).toMatchObject({ x: 0, y: 2.2 });
    const p = at(3);
    expect(p.k === 'point' && p.x).toBe(3);
    expect(p.k === 'point' && Math.abs(p.y)).toBeLessThan(2.2);
  });
  it('silhouette plays its clip by name, frame by frame', () => {
    const g = byId('silhouette');
    expect(Object.keys(g.script!.clips!)).toEqual(['apple']);
    const a = run(g, 0).frame.items.find((i) => i.k === 'clip');
    const b = run(g, 1).frame.items.find((i) => i.k === 'clip');
    expect(a && a.k === 'clip' && a.frame).toBe(0);
    expect(b && b.k === 'clip' && b.frame).toBe(24);
  });
});
