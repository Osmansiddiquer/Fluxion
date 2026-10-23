import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_URL,
  base64UrlToBytes,
  base64UrlToText,
  buildLink,
  bytesToBase64Url,
  deflateText,
  encodeValue,
  hasUrlPayload,
  inflateText,
  linkToSpec,
  paramsToSpec,
  readUrlPayload,
  safeDecode,
  specToParams,
  splitParams,
  stripApiParams,
  textToBase64Url,
  MAX_PAYLOAD_CHARS,
} from './url';
import { validateSpec, type FluxionSpec } from './spec';
import { encodeGraph, makeGraph } from '../graphFile';

/** Split a full link into [hash, search] as the browser would. */
function parts(link: string): [string, string] {
  const u = new URL(link);
  return [u.hash, u.search];
}
async function readLink(link: string) {
  return readUrlPayload(...parts(link));
}

describe('base64url', () => {
  it('round-trips unicode text', () => {
    const s = 'r = θ · 2 ≤ π — ✓';
    expect(base64UrlToText(textToBase64Url(s))).toBe(s);
  });
  it('produces URL-safe output without padding', () => {
    const b = bytesToBase64Url(new Uint8Array([251, 255, 191, 0]));
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('also accepts standard base64 with padding', () => {
    expect(base64UrlToText(btoa('hello?>'))).toBe('hello?>');
    expect(base64UrlToText('aGVsbG8_Pg')).toBe('hello?>');
  });
  it('round-trips large byte arrays', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });
  it('rejects junk', () => {
    expect(() => base64UrlToBytes('not base64!')).toThrow();
    expect(() => base64UrlToText(bytesToBase64Url(new Uint8Array([0xff, 0xfe])))).toThrow();
  });
});

describe('deflate', () => {
  it('round-trips and compresses', async () => {
    const s = JSON.stringify({ expressions: new Array(50).fill('y = sin(x) + cos(2*x)') });
    const z = await deflateText(s);
    expect(z.length).toBeLessThan(s.length / 5);
    expect(await inflateText(z)).toBe(s);
  });
  it('refuses decompression bombs', async () => {
    const z = await deflateText('a'.repeat(5_000_000));
    await expect(inflateText(z)).rejects.toThrow(/too large/);
  });
  it('rejects corrupt data', async () => {
    await expect(inflateText(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow();
  });
});

describe('safeDecode / encodeValue', () => {
  it('never throws on malformed escapes', () => {
    expect(safeDecode('100%')).toBe('100%');
    expect(safeDecode('a%20b%zz%3D')).toBe('a b%zz=');
    expect(safeDecode('%E2%89%A4')).toBe('≤');
  });
  it('keeps math readable but encodes separators and link-breaking chars', () => {
    expect(encodeValue("y'' = -y + sin(t)")).toBe('y%27%27%20=%20-y%20%2B%20sin(t)');
    expect(encodeValue('a^2/b,c:d')).toBe('a^2/b,c:d');
    expect(encodeValue('y>0 & y<x #x 50%')).toBe('y%3E0%20%26%20y%3Cx%20%23x%2050%25');
    expect(encodeValue('{"a":[1]}|')).toBe('%7B%22a%22:%5B1%5D%7D%7C');
  });
  it('is undone by safeDecode', () => {
    for (const s of ["y'' = -0.2y' - sin(y)", 'r < 2θ & r > 1', '{"a":[1,2]}', '100% #1 + 2*3!']) {
      expect(safeDecode(encodeValue(s))).toBe(s);
    }
  });
});

describe('splitParams', () => {
  it('splits key=value pairs, keeping = inside values', () => {
    expect(splitParams('#expr=y=x^2&xmin=-3', false)).toEqual([
      ['expr', 'y=x^2'],
      ['xmin', '-3'],
    ]);
  });
  it('keeps + literal in fragments but treats it as space in query strings', () => {
    expect(splitParams('#expr=y=x+1', false)).toEqual([['expr', 'y=x+1']]);
    expect(splitParams('?expr=y+%3D+x%2B1', true)).toEqual([['expr', 'y = x+1']]);
  });
  it('does not split an unencoded & inside a compound inequality', () => {
    expect(splitParams('#expr=y>0&y<x&color=red', false)).toEqual([
      ['expr', 'y>0&y<x'],
      ['color', 'red'],
    ]);
    expect(splitParams('#expr=y>0%26y<x', false)).toEqual([['expr', 'y>0&y<x']]);
  });
  it('tolerates empty parts and missing values', () => {
    expect(splitParams('#&expr=y=x&&hidden', false)).toEqual([
      ['expr', 'y=x'],
      ['hidden', ''],
    ]);
    expect(splitParams('#', false)).toEqual([]);
  });
});

describe('paramsToSpec', () => {
  const p = (s: string) => paramsToSpec(splitParams(s, false));
  it('attaches per-expression params to the latest expr', () => {
    const { spec, warnings } = p(
      "#expr=y''=-y&ic=1,0&t0=0&color=blue&expr=k=2&min=0&max=5&step=0.5&anim=bounce&speed=2" +
        '&expr=r=theta&thetamax=4pi&hidden=1&expr=(1,2)&label=P&labeldir=ne&size=8&drag=off',
    );
    expect(warnings).toEqual([]);
    expect(spec.expressions).toEqual([
      { expr: "y''=-y", ic: [1, 0], t0: 0, color: 'blue' },
      { expr: 'k=2', min: 0, max: 5, step: 0.5, anim: 'bounce', speed: 2 },
      { expr: 'r=theta', thetaMax: '4pi', hidden: true },
      { expr: '(1,2)', label: 'P', labelDir: 'ne', pointSize: 8, drag: 'off' },
    ]);
  });
  it('reads graph-level params', () => {
    const { spec } = p('#expr=y=x&xmin=-1&xmax=1&ymin=-2pi&ymax=2&sigfigs=4&panels=none&markers=off');
    expect(spec.viewport).toEqual({ xmin: -1, xmax: 1, ymin: '-2pi', ymax: 2 });
    expect(spec.sigFigs).toBe(4);
    expect(spec.panels).toEqual({ right: false, bottom: false });
    expect(Object.values(spec.features!).every((v) => v === false)).toBe(true);
    expect(p('#expr=y=x&panels=right').spec.panels).toEqual({ right: true, bottom: false });
    expect(p('#expr=y=x&panels=both').spec.panels).toEqual({ right: true, bottom: true });
  });
  it('accepts hex colours without the # (which cannot appear in a fragment)', () => {
    expect(p('#expr=y=x&color=c74440').spec.expressions[0]).toMatchObject({ color: '#c74440' });
    expect(p('#expr=y=x&color=%23c74440').spec.expressions[0]).toMatchObject({ color: '#c74440' });
    expect(p('#expr=y=x&color=red').spec.expressions[0]).toMatchObject({ color: 'red' });
  });
  it('is case-insensitive in keys', () => {
    expect(p('#EXPR=y=x&XMin=-1').spec).toEqual({ expressions: [{ expr: 'y=x' }], viewport: { xmin: -1 } });
  });
  it('warns about unknown or orphan params (and still loads)', () => {
    const { spec, warnings } = p('#color=red&expr=y=x&colr=blue&panels=sideways');
    expect(spec.expressions).toEqual([{ expr: 'y=x' }]);
    expect(warnings.join('\n')).toMatch(/before any expr/);
    expect(warnings.join('\n')).toMatch(/unknown parameter "colr" — did you mean "color"/);
    expect(warnings.join('\n')).toMatch(/panels=sideways/);
  });
  it('leaves bad values for validateSpec to report', () => {
    const r = validateSpec(p('#expr=y=x&hidden=maybe&size=huge').spec);
    expect(r.ok).toBe(false);
  });
});

describe('specToParams', () => {
  it('round-trips through paramsToSpec', () => {
    const spec: FluxionSpec = {
      expressions: ["y'' = -y", { expr: 'k = 2', min: 0, max: 5 }, { expr: 'y > k & y < 4', color: '#c74440', hidden: true }],
      viewport: { xmin: -1, xmax: 1, ymin: -2, ymax: 2 },
      panels: { right: false, bottom: false },
      sigFigs: 4,
    };
    const s = specToParams(spec)!;
    const back = paramsToSpec(splitParams('#' + s, false)).spec;
    expect(validateSpec(back)).toEqual(validateSpec(spec));
  });
  it('returns null for things the simple form cannot express', () => {
    expect(specToParams({ expressions: [], panels: { sliceX: 2 } })).toBeNull();
    expect(specToParams({ expressions: [], features: { extrema: false } })).toBeNull();
  });
});

describe('readUrlPayload', () => {
  it('returns none for unrelated URLs', async () => {
    expect(await readUrlPayload('', '')).toEqual({ kind: 'none' });
    expect(await readUrlPayload('#about', '?utm_source=x')).toEqual({ kind: 'none' });
    expect(await readUrlPayload('#', '?')).toEqual({ kind: 'none' });
  });
  it('reads the simple params form from the fragment or the query', async () => {
    const a = await readUrlPayload('#expr=y=x^2+1', '');
    expect(a).toMatchObject({ kind: 'spec', format: 'params', spec: { expressions: [{ expr: 'y=x^2+1' }] } });
    const b = await readUrlPayload('', '?expr=y%3Dx%5E2%2B1&utm_source=chat');
    expect(b).toMatchObject({ kind: 'spec', spec: { expressions: [{ expr: 'y=x^2+1' }] } });
  });
  it('prefers the fragment over the query', async () => {
    const r = await readUrlPayload('#expr=y=1', '?expr=y=2');
    expect(r).toMatchObject({ spec: { expressions: [{ expr: 'y=1' }] } });
  });
  it('reads #spec= as raw, percent-encoded or base64url JSON', async () => {
    const spec = { expressions: ["y' = -y"], viewport: { xmin: 0, xmax: 5 } };
    const json = JSON.stringify(spec);
    for (const [hash, format] of [
      [`#spec=${json}`, 'json'],
      [`#spec=${encodeURIComponent(json)}`, 'json'],
      [`#spec=${encodeValue(json)}`, 'json'],
      [`#spec=${textToBase64Url(json)}`, 'b64'],
      [`#spec=${btoa(json)}`, 'b64'],
    ] as const) {
      expect(await readUrlPayload(hash, '')).toEqual({ kind: 'spec', spec, format, warnings: [] });
    }
  });
  it('reads #z= compressed JSON', async () => {
    const spec = { expressions: ['y = sin(x)'] };
    const z = bytesToBase64Url(await deflateText(JSON.stringify(spec)));
    expect(await readUrlPayload(`#z=${z}`, '')).toEqual({ kind: 'spec', spec, format: 'z', warnings: [] });
  });
  it('returns friendly errors for damaged payloads', async () => {
    for (const hash of ['#spec={"expressions":[', '#spec=%%%', '#z=AAAA', '#z=!!', '#g=notbase64!!', '#g=' + btoa('{"x":1}')]) {
      const r = await readUrlPayload(hash, '');
      expect(r.kind).toBe('error');
      if (r.kind === 'error') expect(r.message).toMatch(/link/);
    }
  });
  it('refuses absurdly long payloads', async () => {
    const r = await readUrlPayload('#spec=' + 'a'.repeat(MAX_PAYLOAD_CHARS + 1), '');
    expect(r).toMatchObject({ kind: 'error', message: expect.stringMatching(/too long/) });
  });
  it('keeps legacy #g= share links working', async () => {
    const graph = makeGraph({
      entries: [{ id: '1', raw: 'r = 2θ', color: '#c74440', visible: true, expanded: true, thetaMax: 12 }],
      viewport: { tMin: -1, tMax: 1, yMin: -1, yMax: 1 },
      features: { extrema: true, xIntercepts: true, yIntercept: true, endpoints: false, discontinuities: true, intersections: true },
      projections: { rightOpen: false, bottomOpen: true, sliceT: 0, sliceY: 1 },
      sigFigs: 3,
    });
    const link = `${DEFAULT_BASE_URL}#g=${encodeGraph(graph)}`;
    expect(await readLink(link)).toEqual({ kind: 'legacy', graph });
    // …also when a mail client percent-encoded the base64 padding.
    const mangled = link.replace(/=+$/, (m) => '%3D'.repeat(m.length));
    expect(await readLink(mangled)).toEqual({ kind: 'legacy', graph });
  });
});

describe('buildLink', () => {
  const spec: FluxionSpec = {
    expressions: [{ expr: "y'' = -0.3y' - sin(y)", ic: [2, 0] }, 'y > 0 & y < 1'],
    viewport: { xmin: 0, xmax: 20 },
  };
  for (const format of ['z', 'json', 'b64', 'params'] as const) {
    it(`round-trips the ${format} format`, async () => {
      const link = await buildLink(spec, { format });
      expect(link.startsWith(DEFAULT_BASE_URL + '#')).toBe(true);
      const r = await readLink(link);
      expect(r.kind).toBe('spec');
      if (r.kind === 'spec') expect(validateSpec(r.spec)).toEqual(validateSpec(spec));
    });
  }
  it('defaults to the compressed format', async () => {
    expect(await buildLink(spec)).toMatch(/#z=[A-Za-z0-9_-]+$/);
  });
  it('produces links that survive markdown / chat auto-linking (no spaces, quotes, brackets)', async () => {
    for (const format of ['z', 'json', 'b64', 'params'] as const) {
      const link = await buildLink(spec, { format });
      expect(link).not.toMatch(/[\s"'<>{}[\]|\\]/);
      // Parentheses may appear (readable math) but always balanced.
      expect(link.split('(').length).toBe(link.split(')').length);
    }
    expect(await buildLink(spec, { format: 'z' })).toMatch(/^[\w:/.#=-]+$/);
  });
  it('honours a custom base URL and replaces an existing fragment', async () => {
    expect(await buildLink(spec, { base: 'http://localhost:5173/#old', format: 'params' })).toMatch(
      /^http:\/\/localhost:5173\/#expr=/,
    );
  });
  it('falls back from params to json when needed', async () => {
    expect(await buildLink({ expressions: ['y=x'], panels: { sliceX: 1 } }, { format: 'params' })).toMatch(/#spec=/);
  });
  it('keeps typical graphs well under common URL limits', async () => {
    const big: FluxionSpec = {
      expressions: Array.from({ length: 30 }, (_, i) => ({ expr: `y = ${i}*sin(x/${i + 1}) + cos(${i}x)`, color: 'blue' })),
    };
    expect((await buildLink(big)).length).toBeLessThan(2000);
  });
});

describe('linkToSpec / hasUrlPayload / stripApiParams', () => {
  it('decodes any link form back to a spec', async () => {
    expect(await linkToSpec(`${DEFAULT_BASE_URL}#expr=y=x`)).toEqual({ spec: { expressions: [{ expr: 'y=x' }] }, warnings: [] });
    expect(await linkToSpec('#expr=y=x')).toMatchObject({ spec: { expressions: [{ expr: 'y=x' }] } });
    expect(await linkToSpec('expr=y=x')).toMatchObject({ spec: { expressions: [{ expr: 'y=x' }] } });
    expect(await linkToSpec(DEFAULT_BASE_URL)).toMatchObject({ error: expect.stringMatching(/No Fluxion graph/) });
  });
  it('converts legacy share links to a spec', async () => {
    const graph = makeGraph({
      entries: [{ id: '1', raw: 'y = x', color: '#c74440', visible: true, expanded: true }],
      viewport: { tMin: -8, tMax: 8, yMin: -5, yMax: 5 },
      features: { extrema: true, xIntercepts: true, yIntercept: true, endpoints: false, discontinuities: true, intersections: true },
      projections: { rightOpen: true, bottomOpen: true, sliceT: 0, sliceY: 1 },
      sigFigs: 3,
    });
    expect(await linkToSpec(`${DEFAULT_BASE_URL}#g=${encodeGraph(graph)}`)).toEqual({
      spec: { version: 1, expressions: ['y = x'] },
      warnings: [],
    });
  });
  it('hasUrlPayload', () => {
    expect(hasUrlPayload('#expr=y=x', '')).toBe(true);
    expect(hasUrlPayload('#g=abc', '')).toBe(true);
    expect(hasUrlPayload('', '?a=1&spec=x')).toBe(true);
    expect(hasUrlPayload('#Z=abc', '')).toBe(true);
    expect(hasUrlPayload('#about', '?q=1')).toBe(false);
    expect(hasUrlPayload('', '?express=1')).toBe(false);
  });
  it('stripApiParams keeps unrelated query params', () => {
    expect(stripApiParams('?expr=y%3Dx&xmin=1&utm_source=chat')).toBe('?utm_source=chat');
    expect(stripApiParams('?expr=y>0&y<x')).toBe('');
    expect(stripApiParams('?utm=1')).toBe('?utm=1');
    expect(stripApiParams('')).toBe('');
  });
});
