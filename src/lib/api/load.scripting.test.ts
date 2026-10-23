import { describe, expect, it } from 'vitest';
import { loadFromUrl, sanitizeGraph } from './load';
import { encodeGraph, makeGraph, type GraphData } from '../graphFile';
import { checkSpec } from './check';
import { DEFAULT_FEATURES, graphToSpec, specToGraph, validateSpec } from './spec';
import { DEMOS } from '../demos';
import { registerAssets, _resetAssets, assetId } from '../frames/assets';
import { encodeClip } from '../frames/codec';
import { computeAll } from '../compute';
import type { Entry } from '../../store/types';

function legacy(entries: Partial<Entry>[], extra: Partial<GraphData> = {}): GraphData {
  return {
    v: 1,
    entries: entries as Entry[],
    viewport: { tMin: -2, tMax: 2, yMin: -1, yMax: 1 },
    features: { ...DEFAULT_FEATURES },
    projections: { rightOpen: false, bottomOpen: false, sliceT: 0, sliceY: 1 },
    sigFigs: 3,
    ...extra,
  };
}

const STYLE_KEYS = [
  'lineWidth',
  'lineStyle',
  'fill',
  'fillOpacity',
  'colorExpr',
  'fillColor',
  'autoplay',
  'frames',
  'thetaMin',
  'thetaMax',
] as const;

describe('share links keep the scripting layer (styles, frames, grid)', () => {
  it.each(DEMOS.map((d) => [d.id, d] as const))('demo %s survives #g= → loadFromUrl', async (_id, demo) => {
    _resetAssets();
    const g = demo.build();
    registerAssets(g.assets);
    const link = '#g=' + encodeGraph(makeGraph(g));
    _resetAssets(); // the receiving browser has never seen the clip
    const r = await loadFromUrl(link, '');
    expect(r?.tone).toBe('info');
    const out = r!.graph!;
    g.entries.forEach((e, i) => {
      for (const k of STYLE_KEYS) expect(out.entries[i][k], `${demo.id}[${i}].${k}`).toEqual(e[k]);
    });
    expect(out.features.grid).toBe(false);
    expect(out.assets).toEqual(g.assets);
    registerAssets(out.assets); // what GraphMenu does before loadGraph
    const res = computeAll(out.entries, out.viewport, 300);
    for (const e of out.entries) {
      const rr = res.get(e.id)!;
      expect(rr.error, `${demo.id}: ${e.raw}`).toBeUndefined();
      expect(rr.unknownFns ?? []).toEqual([]);
    }
  });

  it('demo graphs (minus frames) also round-trip through the LLM spec', () => {
    for (const demo of DEMOS.filter((d) => d.id !== 'silhouette')) {
      const g = demo.build();
      const spec = graphToSpec(g);
      const v = validateSpec(JSON.parse(JSON.stringify(spec)));
      expect(v.ok, demo.id).toBe(true);
      if (!v.ok) continue;
      const back = specToGraph(v.spec);
      g.entries.forEach((e, i) => {
        for (const k of ['lineWidth', 'lineStyle', 'fill', 'fillOpacity', 'colorExpr', 'fillColor'] as const) {
          expect(back.entries[i][k], `${demo.id}[${i}].${k}`).toEqual(e[k]);
        }
        expect(!!back.entries[i].autoplay).toBe(!!e.autoplay);
      });
      expect(back.features.grid).toBe(false);
      const check = checkSpec(spec);
      expect(check.errors, demo.id).toEqual([]);
    }
  });
});

describe('sanitizeGraph — scripting fields', () => {
  it('keeps slow real-time play speeds', () => {
    const out = sanitizeGraph(legacy([{ id: 'a', raw: 'T = 0', color: '#000000', animSpeed: 4 / 219 }]));
    expect(out.entries[0].animSpeed).toBeCloseTo(4 / 219);
  });

  it('bounds and validates style fields', () => {
    const out = sanitizeGraph(
      legacy([
        {
          id: 'a',
          raw: '(cos(t), sin(t))',
          color: '#000000',
          lineWidth: 1e6,
          lineStyle: 'wavy' as never,
          fill: 'yes' as never,
          fillOpacity: 7,
          colorExpr: 'x'.repeat(500),
          fillColor: 'rgb(',
          autoplay: 'true' as never,
          frames: '../../etc',
        },
        {
          id: 'b',
          raw: 'y = x',
          color: '#000000',
          lineWidth: -3,
          colorExpr: 'hsv(360*a, 1, 1)',
          fillColor: '#abc',
          lineStyle: 'dotted',
          fill: false,
        },
      ]),
    );
    const [a, b] = out.entries;
    expect(a.lineWidth).toBe(20);
    expect(a.fillOpacity).toBe(1);
    for (const k of ['lineStyle', 'fill', 'colorExpr', 'fillColor', 'autoplay', 'frames'] as const) {
      expect(a[k], k).toBeUndefined();
    }
    expect(b).toMatchObject({ lineWidth: 0, colorExpr: 'hsv(360*a, 1, 1)', fillColor: '#abc', lineStyle: 'dotted', fill: false });
  });

  it('keeps only referenced, content-verified, well-formed assets', () => {
    const clip = encodeClip({ w: 2, h: 2, fps: 10, box: [0, 0, 1, 1], frames: [[]] });
    const id = assetId(clip);
    const other = encodeClip({ w: 4, h: 4, fps: 10, box: [0, 0, 1, 1], frames: [[]] });
    const entries = [{ id: 'f', raw: 'frames(0)', color: '#000000', frames: id }];
    expect(sanitizeGraph(legacy(entries, { assets: { [id]: clip } })).assets).toEqual({ [id]: clip });
    // unreferenced
    expect(sanitizeGraph(legacy(entries, { assets: { [assetId(other)]: other } })).assets).toBeUndefined();
    // a different payload under a known id
    expect(sanitizeGraph(legacy(entries, { assets: { [id]: other } })).assets).toBeUndefined();
    // not a clip
    const junk = 'not a clip';
    expect(
      sanitizeGraph(legacy([{ ...entries[0], frames: assetId(junk) }], { assets: { [assetId(junk)]: junk } })).assets,
    ).toBeUndefined();
    // wrong shape
    expect(sanitizeGraph(legacy(entries, { assets: [clip] as never })).assets).toBeUndefined();
  });

  it('keeps the grid toggle (booleans only)', () => {
    expect(sanitizeGraph(legacy([], { features: { ...DEFAULT_FEATURES, grid: false } })).features.grid).toBe(false);
    expect(
      sanitizeGraph(legacy([], { features: { ...DEFAULT_FEATURES, grid: 'no' as never } })).features.grid,
    ).toBeUndefined();
  });
});

describe('untrusted scripting input never evaluates mathjs internals', () => {
  const VP = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
  const entry = (raw: string, extra: Partial<Entry> = {}): Entry => ({
    id: raw,
    raw,
    color: '#000000',
    visible: true,
    expanded: false,
    ...extra,
  });
  it('a derived value or function body calling evaluate is never run', () => {
    const res = computeAll([entry('b = evaluate("1")'), entry('f(u) = createUnit("q") + u'), entry('y = f(x)')], VP);
    expect(res.get('b = evaluate("1")')!.unknownFns).toEqual(['evaluate']);
    expect(res.get('b = evaluate("1")')!.value).toBeUndefined();
    expect(res.get('f(u) = createUnit("q") + u')!.unknownFns).toEqual(['createUnit']);
    expect(res.get('y = f(x)')!.curve.segments).toEqual([]);
  });
  it('a colour expression calling evaluate is ignored', async () => {
    const { evalColor } = await import('../color');
    expect(evalColor('hsv(evaluate("1"), 1, 1)', {})).toBeNull();
    expect(evalColor('hsv(f(1), 1, 1)', { f: () => 120 })).not.toBeNull();
  });
});
