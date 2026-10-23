import { describe, expect, it } from 'vitest';
import { LIMITS, graphToSpec, specToGraph, validateSpec } from './spec';
import { checkSpec } from './check';
import { loadFromUrl, sanitizeGraph } from './load';
import { buildLink, buildShareLink, readUrlPayload, specToParams } from './url';
import { makeGraph, type GraphData } from '../graphFile';
import { advance, entriesAtTime, frameAt, valueAt } from '../anim';
import { valuesAtFrame } from '../../state/animate';
import type { Entry } from '../../store/types';

const errs = (spec: unknown) => {
  const v = validateSpec(spec);
  return v.ok ? '' : v.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
};

const SCENE = {
  expressions: [
    { expr: 'T = 0', min: 0, max: 60, anim: 'loop', speed: 0.0667, autoplay: true },
    { expr: '((-16, -9), (16, -9), (16, 9), (-16, 9))', fill: true, fillColor: 'linear(0, 9, 0, -9, #0b1d3a, #f28c38)', lineWidth: 0 },
    'far = layer(-0.1*T, 0)',
    {
      expr: '(1.5cos(t) + 4k - 12, 0.6sin(t) + 5) for k = 0..6',
      layer: 'far', fill: true, fillColor: 'hsv(210, 0.05*k, 1)', samples: 64, blend: 'screen', glow: 8, blur: 1,
    },
    { expr: '((0, 0), (1, 1), (2, 0))', dots: false },
  ],
  aspect: '16/9',
  fps: 24,
};

const scene = (): GraphData => {
  const v = validateSpec(SCENE);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return specToGraph(v.spec);
};

describe('animation options in the JSON spec', () => {
  it('validate and map onto entries / features', () => {
    const g = scene();
    expect(g.features.aspect).toBeCloseTo(16 / 9, 12);
    expect(g.features.fps).toBe(24);
    expect(g.entries[3]).toMatchObject({ layer: 'far', samples: 64, blend: 'screen', glow: 8, blur: 1 });
    expect(g.entries[4].dots).toBe(false);
  });

  it('round-trip through graphToSpec, share links, saved graphs (sanitizeGraph)', async () => {
    const g = scene();
    const v2 = validateSpec(graphToSpec(g));
    if (!v2.ok) throw new Error('invalid round trip');
    const back = specToGraph(v2.spec);
    const strip = (es: Entry[]) => es.map(({ id: _i, ...e }) => e);
    expect(strip(back.entries)).toEqual(strip(g.entries));
    expect(back.features).toEqual(g.features);
    // The app's "Copy share link" → open it.
    const share = await buildShareLink(makeGraph(g), 'https://x.test/');
    const out = await loadFromUrl(new URL(share).hash, '');
    expect(out?.graph?.entries[3]).toMatchObject({ layer: 'far', samples: 64, blend: 'screen', glow: 8, blur: 1 });
    expect(out?.graph?.features).toMatchObject({ aspect: g.features.aspect, fps: 24 });
    // Legacy links, files and saved graphs carry whole GraphData through sanitizeGraph.
    const s = sanitizeGraph(JSON.parse(JSON.stringify(g)));
    expect(s.entries[3]).toMatchObject({ layer: 'far', samples: 64, blend: 'screen', glow: 8, blur: 1 });
    expect(s.entries[4].dots).toBe(false);
    expect(s.features).toMatchObject({ aspect: g.features.aspect, fps: 24 });
  });

  it('sanitizeGraph bounds hostile values', () => {
    const g = {
      v: 1,
      entries: [
        { id: 'a', raw: 'y = x', color: '#000000', visible: true, expanded: true, samples: 1e9, glow: 999, blur: -4, blend: 'evil', layer: 'x; drop', dots: 'yes' },
      ],
      viewport: { tMin: -1, tMax: 1, yMin: -1, yMax: 1 },
      features: { aspect: 1e6, fps: -3 },
    } as unknown as GraphData;
    const out = sanitizeGraph(g);
    const e = out.entries[0];
    expect(e).toMatchObject({ samples: LIMITS.maxSamples, glow: 50, blur: 0 });
    expect(e.blend).toBeUndefined();
    expect(e.layer).toBeUndefined();
    expect(e.dots).toBeUndefined();
    expect(out.features.aspect).toBeUndefined();
    expect(out.features.fps).toBeUndefined();
  });

  it('reject bad values with clear errors', () => {
    expect(errs({ expressions: [{ expr: 'y = x', samples: 2 }] })).toMatch(/samples.*≥ 8/);
    expect(errs({ expressions: [{ expr: 'y = x', blend: 'lighter' }] })).toMatch(/blend.*"add"/);
    expect(errs({ expressions: [{ expr: 'y = x', glow: 60 }] })).toMatch(/glow.*≤ 50/);
    expect(errs({ expressions: [{ expr: 'y = x', layer: '1bad' }] })).toMatch(/layer/);
    expect(errs({ expressions: ['y = x'], aspect: 0 })).toMatch(/aspect/);
    expect(errs({ expressions: ['y = x'], fps: 1000 })).toMatch(/fps/);
    expect(errs({ expressions: ['y = x'], time: 1, frame: 2 })).toMatch(/not both/);
  });

  it('checkSpec warns about a missing layer and misplaced options', () => {
    const r = checkSpec({ expressions: [{ expr: 'y = x', layer: 'far', dots: true }, { expr: 'k = 1', samples: 50 }] });
    const msgs = r.warnings.map((w) => w.message).join('\n');
    expect(msgs).toMatch(/no layer called "far"/);
    expect(msgs).toMatch(/dots only apply/);
    expect(msgs).toMatch(/samples only apply/);
    expect(checkSpec(SCENE).errors).toEqual([]);
  });

  it('params links carry the options', async () => {
    const link =
      'https://x.test/#expr=T=0&min=0&max=10&autoplay=1&expr=(cos(t),sin(t))&samples=64&blend=add&glow=5&blur=1&layer=far&dots=0&expr=far=layer(T,0)&aspect=2.39&fps=24';
    const out = await loadFromUrl(new URL(link).hash, '');
    expect(out?.tone).toBe('info');
    expect(out?.graph?.entries[1]).toMatchObject({ samples: 64, blend: 'add', glow: 5, blur: 1, layer: 'far', dots: false });
    expect(out?.graph?.features).toMatchObject({ aspect: 2.39, fps: 24 });
    const p = specToParams(graphToSpec(scene()));
    expect(p).toContain('samples=64');
    expect(p).toContain('fps=24');
  });
});

describe('deterministic clock', () => {
  it('valueAt agrees with the real-time advance() and is a pure function of time', () => {
    for (const mode of ['loop', 'once'] as const) {
      let v = 1;
      let dir: 1 | -1 = 1;
      const dt = 1 / 60;
      for (let i = 1; i <= 600; i++) {
        const r = advance(v, dir, 0, 4, mode, 1.3, dt);
        v = r.value;
        dir = r.dir;
        expect(Math.abs(valueAt(1, 0, 4, mode, 1.3, i * dt).value - v)).toBeLessThan(1e-9);
      }
    }
    expect(valueAt(1, 0, 4, 'loop', 1, 1000).value).toBe(valueAt(1, 0, 4, 'loop', 1, 1000).value);
    // A bounce reflects the overshoot (advance() clips it to the end).
    expect(valueAt(3.5, 0, 4, 'bounce', 1, 1)).toMatchObject({ value: 3.5, dir: -1 });
    expect(valueAt(3.5, 0, 4, 'once', 1, 1)).toMatchObject({ value: 4, finished: true });
  });

  it('frame N of a fixed-fps run is the same however the frames arrived', () => {
    const e: Entry = { id: 'T', raw: 'T = 0', color: '#000', visible: true, expanded: false, varMin: 0, varMax: 10, animMode: 'loop', animSpeed: 0.4 };
    const at = (n: number) => valuesAtFrame([e], ['T'], new Map([['T', 0]]), n, 24).values.get('T');
    expect(at(48)).toBe(at(48));
    expect(at(48)).toBeCloseTo(valueAt(0, 0, 10, 'loop', 0.4, 2).value, 12);
    expect(frameAt(2, 24)).toBe(48);
    expect(frameAt(47.999 / 24, 24)).toBe(47);
  });

  it('time / frame open the graph paused on that frame', async () => {
    const spec = { expressions: [{ expr: 'T = 0', min: 0, max: 10, anim: 'loop', autoplay: true }, 'y = T'], fps: 10 };
    const v = validateSpec({ ...spec, frame: 25 });
    if (!v.ok) throw new Error('invalid');
    const g = specToGraph(v.spec);
    expect(g.entries[0].autoplay).toBeUndefined();
    const want = valueAt(0, 0, 10, 'loop', 1, 2.5).value;
    expect(g.entries[0].varValue).toBeCloseTo(want, 12);
    // `&frame=` appended to a compressed link, and `&time=` on a params link.
    const z = await buildLink(spec as never);
    const p = await readUrlPayload(new URL(`${z}&frame=25`).hash, '');
    const vz = validateSpec(p.kind === 'spec' ? p.spec : null);
    expect(vz.ok && specToGraph(vz.spec).entries[0].varValue).toBeCloseTo(want, 12);
    const out = await loadFromUrl('#expr=T=0&min=0&max=10&autoplay=1&expr=y=T&time=2.5', '');
    expect(out?.graph?.entries[0].varValue).toBeCloseTo(want, 12);
    expect(entriesAtTime(g.entries, 1)).toEqual(g.entries); // already paused: unchanged
  });
});
