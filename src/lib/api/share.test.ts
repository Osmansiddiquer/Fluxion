import { describe, expect, it } from 'vitest';
import { buildShareLink, hasUrlPayload, readUrlPayload, stripApiParams } from './url';
import { loadFromUrl } from './load';
import { encodeGraph, makeGraph, type GraphData } from '../graphFile';
import { DEFAULT_FEATURES, DEFAULT_PROJECTIONS, DEFAULT_VIEWPORT } from './spec';
import { DEMOS } from '../demos';
import { registerAssets } from '../frames/assets';
import { computeAll } from '../compute';
import type { Entry } from '../../store/types';

const BASE = 'https://osmansiddiquer.github.io/Fluxion/';

function graphOf(entries: Partial<Entry>[], extra: Partial<GraphData> = {}): GraphData {
  return {
    ...makeGraph({
      entries: entries.map((e, i) => ({
        id: crypto.randomUUID(),
        raw: '',
        color: ['#c74440', '#2d70b3', '#388c46'][i % 3],
        visible: true,
        expanded: true,
        ...e,
      })),
      viewport: DEFAULT_VIEWPORT,
      features: DEFAULT_FEATURES,
      projections: DEFAULT_PROJECTIONS,
      sigFigs: 3,
    }),
    ...extra,
  };
}

/** What a user sees: everything but ids and the expanded/collapsed UI state. */
function visible(g: GraphData) {
  return {
    entries: g.entries.map(({ id: _i, expanded: _x, varValue, raw, ...e }) => {
      // A slider's value is folded into its text (k = 1.5) in the compact link.
      const m = varValue !== undefined ? raw.match(/^\s*([A-Za-z]\w*)\s*=/) : null;
      return { ...e, raw: m ? `${m[1]} = ${varValue}` : raw };
    }),
    viewport: g.viewport,
    features: { ...DEFAULT_FEATURES, ...g.features },
    // An expression-driven cut stores only the expression; its number is derived.
    projections: g.projections.sliceTExpr ? { ...g.projections, sliceT: undefined } : g.projections,
    sigFigs: g.sigFigs,
    script: g.script,
  };
}

async function reopen(link: string) {
  const u = new URL(link);
  const r = await loadFromUrl(u.hash, u.search);
  expect(r?.tone, link.slice(0, 80)).toBe('info');
  return r!.graph!;
}

const typical = graphOf([
  { raw: "y'' = -0.3y' - sin(y)", ic: [2, 0] },
  { raw: 'y = k sin(x)' },
  { raw: 'k = 1', varValue: 1.5, varMin: 0, varMax: 3, animMode: 'bounce' },
  { raw: 'x^2 + y^2 < 9', visible: false },
  { raw: '(1, 2)', pointLabel: 'P', pointSize: 7 },
  { raw: 'r = 1 + cos(theta)', thetaMin: 0, thetaMax: 4 * Math.PI, lineWidth: 3, lineStyle: 'dashed' },
], {
  viewport: { tMin: -3, tMax: 12, yMin: -4, yMax: 4 },
  features: { ...DEFAULT_FEATURES, intersections: true, grid: false },
  projections: { rightOpen: false, bottomOpen: true, sliceT: 2, sliceY: 0.5, sliceTExpr: 'k' },
  sigFigs: 5,
});

describe('share links', () => {
  it('a typical graph reopens identically (ids/expanded aside)', async () => {
    const link = await buildShareLink(typical, BASE);
    expect(link.startsWith(BASE + '#z=')).toBe(true);
    expect(visible(await reopen(link))).toEqual(visible(typical));
  });

  it('is several times shorter than the old #g= link', async () => {
    const link = await buildShareLink(typical, BASE);
    const old = `${BASE}#g=${encodeGraph(typical)}`;
    expect(link.length * 3).toBeLessThan(old.length);
  });

  for (const d of DEMOS) {
    it(`demo ${d.id} round-trips and computes`, async () => {
      const g = d.build();
      registerAssets(g.assets);
      const link = await buildShareLink(g, BASE);
      expect(link).toMatch(g.assets ? /#gz=/ : /#z=/);
      const back = await reopen(link);
      expect(visible(back)).toEqual(visible(g));
      expect(Object.keys(back.assets ?? {})).toEqual(Object.keys(g.assets ?? {}));
      const res = computeAll(back.entries, back.viewport, 300);
      for (const e of back.entries) expect(res.get(e.id)!.parsed.kind, e.raw).not.toBe('error');
      // Much shorter than the old format. (A script-only example is mostly its
      // code, which both formats carry, so it can't halve; just never longer.)
      const old = `${BASE}#g=${encodeGraph(g)}`.length;
      if (g.script && !g.entries.length) expect(link.length).toBeLessThan(old * 1.1);
      else expect(link.length).toBeLessThan(old / 2);
    });
  }

  it('#gz= entries get fresh unique ids and default expanded', async () => {
    const clip = DEMOS.find((d) => d.build().assets);
    if (!clip) return;
    const back = await reopen(await buildShareLink(clip.build(), BASE));
    const ids = back.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(back.entries.every((e) => e.expanded === true)).toBe(true);
  });

  it('a damaged #gz= link is a friendly error', async () => {
    const p = await readUrlPayload('#gz=not-really-deflate', '');
    expect(p.kind).toBe('error');
  });

  it('#gz= is recognised as a payload and stripped from queries', () => {
    expect(hasUrlPayload('#gz=abc', '')).toBe(true);
    expect(stripApiParams('?gz=abc&utm=1')).toBe('?utm=1');
  });

  it('old #g= links still load', async () => {
    const back = await reopen(`${BASE}#g=${encodeGraph(typical)}`);
    expect(visible(back)).toEqual(visible(typical));
  });

  it('uses the given base (dev server, preview)', async () => {
    const link = await buildShareLink(typical, 'http://localhost:5173/');
    expect(link.startsWith('http://localhost:5173/#z=')).toBe(true);
  });
});
