import { describe, expect, it } from 'vitest';
import { loadFromUrl, sanitizeGraph, sanitizeScript } from './load';
import { decodeGraph, encodeGraph, makeGraph, parseGraphFile, type GraphData } from '../graphFile';
import { DEFAULT_FEATURES, DEFAULT_PROJECTIONS, DEFAULT_VIEWPORT, LIMITS, graphToSpec, specToGraph, validateSpec } from './spec';
import { buildLink, hasUrlPayload, linkToSpec, readUrlPayload, specToParams } from './url';
import { _resetAssets, putAsset, registerAssets } from '../frames/assets';
import { encodeClip } from '../frames/codec';

const CODE = 'const k = slider("k", 0, 5, 2)\nfor (const i of range(3)) circle(i, 0, 0.4 * k, { fill: hsv(120 * i, 0.7, 0.9) })\n// & # % + "quotes" ünïcödé θ\n';

const base = (extra: Partial<GraphData> = {}): GraphData => ({
  v: 1,
  entries: [{ id: 'a', raw: "y'' = -y", color: '#c74440', visible: true, expanded: true, ic: [1, 0] }],
  viewport: { ...DEFAULT_VIEWPORT },
  features: { ...DEFAULT_FEATURES },
  projections: { ...DEFAULT_PROJECTIONS },
  sigFigs: 3,
  ...extra,
});

describe('spec carries a script', () => {
  it('validates, and expressions become optional', () => {
    const v = validateSpec({ script: CODE });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.spec.script).toBe(CODE);
      expect(v.spec.expressions).toEqual([]);
      expect(v.warnings).toEqual([]);
    }
    expect(validateSpec({}).ok).toBe(false);
  });
  it('rejects non-strings and oversize scripts', () => {
    const a = validateSpec({ script: 42 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors[0]).toMatchObject({ path: 'script' });
    const b = validateSpec({ script: 'x'.repeat(LIMITS.maxScriptChars + 1) });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors[0].message).toMatch(/too long/);
  });
  it('suggests "script" for near-misses', () => {
    const v = validateSpec({ expressions: [], scirpt: 'x' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0].message).toMatch(/script/);
  });
  it('spec → graph → spec', () => {
    const v = validateSpec({ expressions: ["y'' = -y"], script: CODE });
    if (!v.ok) throw new Error('invalid');
    const g = specToGraph(v.spec);
    expect(g.script).toEqual({ code: CODE });
    expect(graphToSpec(g)).toMatchObject({ expressions: ["y'' = -y"], script: CODE });
    // No script → no key.
    expect('script' in graphToSpec(base())).toBe(false);
  });
});

describe('links carry a script', () => {
  it.each(['z', 'json', 'b64', 'params'] as const)('%s link round-trips', async (format) => {
    const spec = { expressions: ["y'' = -y"], script: CODE };
    const link = await buildLink(spec, { format });
    const u = new URL(link);
    expect(hasUrlPayload(u.hash, '')).toBe(true);
    const p = await readUrlPayload(u.hash, '');
    expect(p.kind).toBe('spec');
    if (p.kind !== 'spec') return;
    const v = validateSpec(p.spec);
    expect(v.ok && v.spec.script).toBe(CODE);
  });
  it('params form: #script= alone opens a script-only graph', async () => {
    const r = await loadFromUrl('#script=circle(0,0,2,{fill:%22red%22})', '');
    expect(r?.graph?.script?.code).toBe('circle(0,0,2,{fill:"red"})');
    expect(specToParams({ expressions: [], script: 'a && b' })).toBe('script=a%20%26%26%20b');
  });
  it('a legacy #g= share link keeps the script, sliders and clips', async () => {
    _resetAssets();
    const clip = encodeClip({ w: 4, h: 4, fps: 10, box: [-1, -1, 1, 1], frames: [[[[0, 0], [4, 0], [4, 4]]]] });
    const id = putAsset(clip);
    const g = makeGraph({ ...base(), script: { code: CODE, sliders: { k: 4 }, clips: { apple: id }, visible: false } });
    expect(g.assets?.[id]).toBe(clip);
    const r = await loadFromUrl(`#g=${encodeGraph(g)}`, '');
    expect(r?.graph?.script).toEqual({ code: CODE, sliders: { k: 4 }, clips: { apple: id }, visible: false });
    expect(r?.graph?.assets?.[id]).toBe(clip);
  });
  it('linkToSpec decodes a share link with a script into a spec with it', async () => {
    const g = makeGraph({ ...base(), script: { code: CODE } });
    const d = await linkToSpec(`https://x.example/#g=${encodeGraph(g)}`);
    expect((d.spec as { script: string }).script).toBe(CODE);
  });
});

describe('graph files carry a script', () => {
  it('makeGraph omits an empty script; files round-trip', () => {
    expect(makeGraph({ ...base(), script: { code: '  \n' } }).script).toBeUndefined();
    const g = makeGraph({ ...base(), script: { code: CODE, sliders: { k: 1 } } });
    const back = parseGraphFile(JSON.stringify(g));
    expect(sanitizeGraph(back!).script).toEqual({ code: CODE, sliders: { k: 1 } });
    expect(decodeGraph(encodeGraph(g))?.script?.code).toBe(CODE);
  });
});

describe('sanitizeScript', () => {
  it('caps the code and type-checks everything else', () => {
    expect(sanitizeScript({ code: 'x'.repeat(LIMITS.maxScriptChars + 1) })).toBeUndefined();
    expect(sanitizeScript({ code: 7 })).toBeUndefined();
    expect(sanitizeScript({ code: '   ' })).toBeUndefined();
    expect(sanitizeScript('code')).toBeUndefined();
    const s = sanitizeScript({
      code: 'ok()',
      sliders: { k: 2, 'bad name!': 1, j: 'x', huge: 1e20, ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, i])) },
      clips: { apple: 'fx0123abcd1a', '../x': 'fx0123abcd1a', pear: 'not-an-id' },
      visible: 'no',
      extra: { evil: true },
    });
    expect(s?.code).toBe('ok()');
    expect(s?.sliders?.k).toBe(2);
    expect(Object.keys(s!.sliders!)).not.toContain('bad name!');
    expect(Object.keys(s!.sliders!).length).toBeLessThanOrEqual(32);
    expect(s?.clips).toEqual({ apple: 'fx0123abcd1a' });
    expect(s && 'visible' in s).toBe(false);
    expect(s && 'extra' in s).toBe(false);
  });
  it('sanitizeGraph keeps only clip assets the script references, and only verified ones', () => {
    _resetAssets();
    const clip = encodeClip({ w: 4, h: 4, fps: 10, box: [-1, -1, 1, 1], frames: [[[[0, 0], [4, 0], [4, 4]]]] });
    const id = putAsset(clip);
    const other = encodeClip({ w: 4, h: 4, fps: 5, box: [-1, -1, 1, 1], frames: [[]] });
    const otherId = putAsset(other);
    const g = sanitizeGraph({
      ...base(),
      script: { code: 'x', clips: { a: id } },
      assets: { [id]: clip, [otherId]: other },
    });
    expect(Object.keys(g.assets ?? {})).toEqual([id]);
    // A payload smuggled under the wrong id is dropped.
    const bad = sanitizeGraph({ ...base(), script: { code: 'x', clips: { a: id } }, assets: { [id]: other } });
    expect(bad.assets).toBeUndefined();
    registerAssets(g.assets);
  });
});
