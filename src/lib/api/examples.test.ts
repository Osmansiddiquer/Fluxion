import { describe, expect, it } from 'vitest';
import { exampleSpec, listExamples } from './examples';
import { hasUrlPayload, linkToSpec, paramsToSpec, readUrlPayload, specToParams, splitParams, stripApiParams } from './url';
import { loadFromUrl } from './load';
import { validateSpec } from './spec';
import { checkSpec } from './check';
import { DEMOS } from '../demos';
import { runCli, type CliIO } from '../../cli/fluxion';

const params = (s: string) => paramsToSpec(splitParams(s, false));

describe('style params in the simple link form', () => {
  it('maps width/style/fill/opacity/colorexpr/fillcolor/autoplay', () => {
    const { spec, warnings } = params(
      '#expr=a=0&anim=loop&autoplay=1&expr=(cos(t),sin(t))&width=3&style=dashed&fill=1&opacity=0.4&colorexpr=hsv(57*a,0.8,0.9)&fillcolor=ff8800',
    );
    expect(warnings).toEqual([]);
    expect(spec.expressions[0]).toEqual({ expr: 'a=0', anim: 'loop', autoplay: true });
    expect(spec.expressions[1]).toEqual({
      expr: '(cos(t),sin(t))',
      lineWidth: 3,
      lineStyle: 'dashed',
      fill: true,
      fillOpacity: 0.4,
      colorExpr: 'hsv(57*a,0.8,0.9)',
      fillColor: '#ff8800',
    });
    expect(validateSpec(spec).ok).toBe(true);
  });

  it('fill=0 and autoplay=0 are false; bad values reach the validator', () => {
    const { spec } = params('#expr=a=0&autoplay=0&expr=(cos(t),sin(t))&fill=0&width=wide');
    expect(spec.expressions[0]).toMatchObject({ autoplay: false });
    expect(spec.expressions[1]).toMatchObject({ fill: false, lineWidth: 'wide' });
    expect(validateSpec(spec).ok).toBe(false);
  });

  it('grid=off/on sets features.grid, and combines with markers=off', () => {
    expect(params('#expr=y=x&grid=off').spec.features).toEqual({ grid: false });
    expect(params('#expr=y=x&grid=on').spec.features).toEqual({ grid: true });
    const both = params('#expr=y=x&markers=off&grid=off').spec.features!;
    expect(both.grid).toBe(false);
    expect(both.extrema).toBe(false);
    expect(params('#expr=y=x&grid=maybe').warnings[0]).toMatch(/grid=maybe/);
  });

  it('round-trips through specToParams', () => {
    const spec = {
      expressions: [
        { expr: 'a = 0', anim: 'loop' as const, autoplay: true },
        { expr: '(cos(t), sin(t))', lineWidth: 2, lineStyle: 'dotted' as const, fill: true, fillOpacity: 0.5, colorExpr: '#336699', fillColor: 'hsv(30, 1, 1)' },
      ],
      features: { grid: false },
    };
    const p = specToParams(spec)!;
    expect(p).toContain('grid=off');
    expect(p).toContain('colorexpr=336699');
    const back = params('#' + p).spec;
    expect(back.expressions).toEqual(spec.expressions);
    expect(back.features).toEqual({ grid: false });
  });

  it('a style param before any expr is ignored with a warning', () => {
    expect(params('#width=3&expr=y=x').warnings[0]).toMatch(/before any expr/);
  });
});

describe('#example= links', () => {
  it('opens every demo, case-insensitively, from the fragment or the query', async () => {
    for (const d of DEMOS) {
      for (const [hash, search] of [
        [`#example=${d.id}`, ''],
        [`#example=${d.id.toUpperCase()}`, ''],
        ['', `?example=${d.id}`],
      ]) {
        const p = await readUrlPayload(hash, search);
        expect(p.kind, hash + search).toBe('legacy');
        if (p.kind === 'legacy') expect(p.graph.entries.length + (p.graph.script?.code ? 1 : 0)).toBeGreaterThan(0);
      }
    }
  });

  it('an unknown id is a friendly error naming the real ones', async () => {
    const p = await readUrlPayload('#example=dragon', '');
    expect(p.kind).toBe('error');
    if (p.kind === 'error') {
      expect(p.message).toMatch(/dragon/);
      for (const d of DEMOS) expect(p.message).toContain(d.id);
    }
  });

  it('is detected as a payload and stripped from the query string', () => {
    expect(hasUrlPayload('#example=cube', '')).toBe(true);
    expect(hasUrlPayload('', '?utm_source=x&example=cube')).toBe(true);
    expect(stripApiParams('?utm_source=x&example=cube')).toBe('?utm_source=x');
  });

  it('loads through the app path with styles and clip assets intact', async () => {
    for (const d of DEMOS) {
      const r = await loadFromUrl(`#example=${d.id}`, '');
      expect(r?.tone, d.id).toBe('info');
      const built = d.build();
      expect(r!.graph!.entries.map((e) => e.raw)).toEqual(built.entries.map((e) => e.raw));
      expect(r!.graph!.entries.map((e) => e.colorExpr)).toEqual(built.entries.map((e) => e.colorExpr));
      expect(Object.keys(r!.graph!.assets ?? {})).toEqual(Object.keys(built.assets ?? {}));
    }
  });

  it('decodes to an editable spec', async () => {
    const d = await linkToSpec('https://osmansiddiquer.github.io/Fluxion/#example=cube');
    expect(d.error).toBeUndefined();
    expect(checkSpec(d.spec).ok).toBe(true);
  });
});

describe('example specs', () => {
  it('every frame-free demo has a spec that checks clean and round-trips', () => {
    for (const ex of listExamples()) {
      const spec = exampleSpec(ex.id);
      if (!ex.spec) {
        expect(spec).toBeNull();
        continue;
      }
      const r = checkSpec(spec);
      expect(r.errors, ex.id).toEqual([]);
      expect(r.warnings, ex.id).toEqual([]);
    }
  });

  it('unknown ids give null; links use the given base', () => {
    expect(exampleSpec('nope')).toBeNull();
    expect(listExamples('http://localhost:5173/#junk')[0].link).toBe(`http://localhost:5173/#example=${DEMOS[0].id}`);
  });
});

describe('fluxion examples / example', () => {
  async function run(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = {
      readFile: async () => '',
      readStdin: async () => '',
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    };
    const code = await runCli(argv, io);
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('lists every demo with its link', async () => {
    const r = await run(['examples']);
    expect(r.code).toBe(0);
    for (const ex of listExamples()) expect(r.out).toContain(ex.link);
  });

  it('prints a spec that the CLI itself accepts', async () => {
    const r = await run(['example', 'mandala']);
    expect(r.code).toBe(0);
    const spec = JSON.parse(r.out);
    expect(spec).toEqual(exampleSpec('mandala'));
    expect(checkSpec(spec).ok).toBe(true);
  });

  it('explains clip demos and rejects unknown or missing ids', async () => {
    const clip = listExamples().find((e) => !e.spec);
    if (clip) {
      const r = await run(['example', clip.id]);
      expect(r.code).toBe(2);
      expect(r.err).toContain(clip.link);
    }
    expect((await run(['example', 'nope'])).code).toBe(2);
    expect((await run(['example'])).err).toMatch(/needs an id/);
  });
});
