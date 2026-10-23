import { describe, expect, it } from 'vitest';
import { loadFromUrl, sanitizeGraph } from './load';
import { buildLink } from './url';
import { encodeGraph, makeGraph, type GraphData } from '../graphFile';
import { DEFAULT_FEATURES, DEFAULT_PROJECTIONS, DEFAULT_VIEWPORT } from './spec';
import type { Entry } from '../../store/types';

const hashOf = (link: string) => new URL(link).hash;

function legacy(entries: Partial<Entry>[], extra: Partial<GraphData> = {}): GraphData {
  return {
    ...makeGraph({
      entries: entries as Entry[],
      viewport: { tMin: -2, tMax: 2, yMin: -1, yMax: 1 },
      features: { ...DEFAULT_FEATURES, extrema: false },
      projections: { rightOpen: false, bottomOpen: true, sliceT: 1, sliceY: 0.5, sliceTExpr: 'k' },
      sigFigs: 4,
    }),
    ...extra,
  };
}

describe('loadFromUrl', () => {
  it('returns null when the URL has no graph', async () => {
    expect(await loadFromUrl('', '')).toBeNull();
    expect(await loadFromUrl('#section', '?ref=x')).toBeNull();
  });

  it('loads a spec link into app entries', async () => {
    const link = await buildLink({ expressions: [{ expr: "y' = -k*y", ic: 3 }, 'k = 0.5'], viewport: { xmin: 0, xmax: 10 } });
    const r = await loadFromUrl(hashOf(link), '');
    expect(r?.tone).toBe('info');
    expect(r?.message).toBeUndefined();
    expect(r?.graph?.entries.map((e) => [e.raw, e.ic])).toEqual([
      ["y' = -k*y", [3]],
      ['k = 0.5', undefined],
    ]);
    expect(r?.graph?.viewport).toEqual({ ...DEFAULT_VIEWPORT, tMin: 0, tMax: 10 });
  });

  it('loads the hand-written params form', async () => {
    const r = await loadFromUrl('#expr=y=sin(x)&color=red&expr=x^2+y^2=4&xmin=-4&xmax=4', '');
    expect(r?.graph?.entries.map((e) => [e.raw, e.color])).toEqual([
      ['y=sin(x)', '#c74440'],
      ['x^2+y^2=4', '#2d70b3'],
    ]);
  });

  it('reports an invalid spec instead of loading it', async () => {
    const r = await loadFromUrl('#spec={"expressions":[{"expr":"y=x","colour":"red"}],"viewport":{"xmin":5,"xmax":1}}', '');
    expect(r).toMatchObject({ tone: 'error' });
    expect(r?.graph).toBeUndefined();
    expect(r?.message).toMatch(/invalid — expressions\[0\]\.colour: unknown key.*\(\+1 more\)/);
  });

  it('reports undecodable links', async () => {
    const r = await loadFromUrl('#z=garbage', '');
    expect(r).toMatchObject({ tone: 'error', message: expect.stringMatching(/Could not read/) });
  });

  it('loads, but flags, expressions that do not parse', async () => {
    const r = await loadFromUrl('#expr=y=sin(x&expr=y=x', '');
    expect(r?.graph?.entries).toHaveLength(2);
    expect(r).toMatchObject({ tone: 'error', message: 'Graph loaded, but 1 expression could not be parsed' });
  });

  it('loads legacy #g= share links unchanged', async () => {
    const g = legacy([
      { id: 'a', raw: "y'' = -y", color: '#c74440', visible: true, expanded: true, t0: 0, ic: [0, 1] },
      { id: 'b', raw: 'k = 2', color: '#2d70b3', visible: false, expanded: false, varValue: 3, varMin: 0, varMax: 5, varStep: 0.1, animMode: 'bounce', animSpeed: 2 },
      { id: 'c', raw: 'r = θ', color: '#388c46', visible: true, expanded: true, thetaMin: 0, thetaMax: 12 },
      { id: 'd', raw: 'A = (1, 2)', color: '#6042a6', visible: true, expanded: true, pointLabel: 'A', pointLabelDir: 'sw', pointSize: 8, pointDrag: 'both' },
    ]);
    const r = await loadFromUrl(`#g=${encodeGraph(g)}`, '');
    expect(r).toEqual({ tone: 'info', graph: g });
  });
});

describe('sanitizeGraph', () => {
  it('is the identity on well-formed graphs', () => {
    const g = legacy([{ id: 'a', raw: 'y = x', color: '#c74440', visible: true, expanded: true }]);
    expect(sanitizeGraph(g)).toEqual(g);
  });

  it('drops unknown fields and bad values', () => {
    const g = legacy([
      {
        id: 'a',
        raw: 'y = x',
        color: 'red; background:url(x)',
        visible: true,
        expanded: true,
        t0: 'evil' as unknown as number,
        ic: [1, Infinity],
        varMin: NaN,
        animMode: 'warp' as never,
        pointSize: 99,
        pointDrag: 'fly' as never,
        pointLabel: 'x'.repeat(500),
        ...({ onclick: 'alert(1)', __proto__: { polluted: 1 } } as object),
      },
    ]);
    const e = sanitizeGraph(g).entries[0];
    expect(e).toEqual({
      id: 'a',
      raw: 'y = x',
      color: '#c74440',
      visible: true,
      expanded: true,
      pointSize: 14,
      pointLabel: 'x'.repeat(100),
    });
  });

  it('skips non-entries, caps the count, truncates long expressions, de-duplicates ids', () => {
    const many = Array.from({ length: 150 }, () => ({ id: 'same', raw: 'y = ' + 'x+'.repeat(800) + 'x', color: '#000000', visible: true, expanded: true }));
    const g = legacy([null as never, { raw: 5 } as never, ...many]);
    const out = sanitizeGraph(g);
    expect(out.entries.length).toBeLessThanOrEqual(100);
    expect(out.entries.every((e) => e.raw.length <= 1000)).toBe(true);
    expect(new Set(out.entries.map((e) => e.id)).size).toBe(out.entries.length);
  });

  it('drops θ ranges that would make polar regions too slow', () => {
    const g = legacy([{ id: 'a', raw: 'r < θ', color: '#c74440', visible: true, expanded: true, thetaMin: 0, thetaMax: 9000 }]);
    const e = sanitizeGraph(g).entries[0];
    expect(e.thetaMin).toBeUndefined();
    expect(e.thetaMax).toBeUndefined();
  });

  it('falls back to defaults for a broken viewport / features / projections / sigFigs', () => {
    const g = legacy([], {
      viewport: { tMin: 5, tMax: 1, yMin: 0, yMax: 1 },
      features: { extrema: 'yes' } as never,
      projections: { rightOpen: 1, sliceT: 'x', sliceTExpr: 'createUnit("q")' } as never,
      sigFigs: 99,
    });
    const out = sanitizeGraph(g);
    expect(out.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(out.features).toEqual(DEFAULT_FEATURES);
    expect(out.projections).toEqual(DEFAULT_PROJECTIONS);
    expect(out.sigFigs).toBe(12);
  });

  it('survives garbage', () => {
    expect(sanitizeGraph({ entries: 'nope', viewport: null } as never).entries).toEqual([]);
  });
});
