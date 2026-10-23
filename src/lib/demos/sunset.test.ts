import { describe, expect, it } from 'vitest';
import { sunsetDemo } from './sunset';
import { computeAll } from '../compute';
import { checkGraph } from '../api/check';
import { sanitizeGraph } from '../api/load';
import { makeGraph, parseGraphFile } from '../graphFile';
import { evalLayers, drawOrder } from '../render/layers';
import { resolveCopyStyles, resolveStyle } from '../style';
import { buildVarScope } from '../math/resolveSlice';
import { entriesAtTime } from '../anim';

describe('the Cinematic sunset example (Graph mode)', () => {
  const g = sunsetDemo();

  it('checks clean and survives a file round trip', () => {
    const { errors, warnings } = checkGraph(g);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const back = sanitizeGraph(parseGraphFile(JSON.stringify(makeGraph({ ...g })))!);
    expect(back.entries.map(({ id: _i, ...e }) => e)).toEqual(g.entries.map(({ id: _i, ...e }) => e));
    expect(back.features).toMatchObject({ aspect: 2.39, fps: 24 });
  });

  it('uses the animation features', () => {
    const res = computeAll(g.entries, g.viewport, 1200);
    const kinds = g.entries.map((e) => res.get(e.id)!.parsed.kind);
    expect(kinds.filter((k) => k === 'layer')).toHaveLength(3);
    expect(g.entries.some((e) => e.fillColor?.startsWith('linear('))).toBe(true);
    expect(g.entries.some((e) => e.blend === 'add')).toBe(true);
    const smooth = g.entries.filter((e) => {
      const p = res.get(e.id)!.parsed;
      return p.kind === 'points' && p.smooth;
    });
    expect(smooth.length).toBeGreaterThanOrEqual(3);
  });

  it('draws every frame of the loop, with per-copy colours and layer transforms', () => {
    for (const time of [0, 3.3, 7.95, 12, 23.9]) {
      const entries = entriesAtTime(g.entries, time);
      const res = computeAll(entries, g.viewport, 1200);
      for (const e of entries) {
        const r = res.get(e.id)!;
        expect(r.error, e.raw).toBeUndefined();
        expect(r.undefinedVars ?? [], e.raw).toEqual([]);
      }
      const scope = buildVarScope(entries);
      const layers = evalLayers(entries, res, scope);
      expect([...layers.values()].every((l) => !l.error)).toBe(true);
      expect(drawOrder(entries, layers)).toHaveLength(entries.length);
      for (const e of entries) resolveStyle(e, res.get(e.id), scope);
      const clouds = entries.find((e) => e.raw.includes('mod(4.5k'))!;
      const per = resolveCopyStyles(clouds, res.get(clouds.id), scope);
      expect(per).toHaveLength(9);
      expect(new Set(per!.map((s) => s.fill)).size).toBe(9);
    }
  });

  it('loops seamlessly: T = 0 and T = 24 draw the same layers', () => {
    const at = (time: number) => {
      const entries = entriesAtTime(g.entries, time);
      entries[0] = { ...entries[0], varValue: time };
      const res = computeAll(entries, g.viewport, 400);
      return [...evalLayers(entries, res, buildVarScope(entries)).values()].map((l) => l.mat.map((v) => Math.round(v * 1e9) / 1e9 + 0));
    };
    expect(at(24)).toEqual(at(0));
  });
});
