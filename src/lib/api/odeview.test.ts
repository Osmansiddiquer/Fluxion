import { describe, expect, it } from 'vitest';
import { graphToSpec, specToGraph, validateSpec } from './spec';
import { checkSpec } from './check';
import { loadFromUrl, sanitizeGraph } from './load';
import { buildShareLink, paramsToSpec, readUrlPayload, specToParams, splitParams } from './url';
import { makeGraph, type GraphData } from '../graphFile';
import { sanitizeStored } from '../saved/library';
import type { Entry } from '../../store/types';
import { SECTIONS } from '../../components/Docs/content';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const errs = (spec: unknown) => {
  const v = validateSpec(spec);
  return v.ok ? '' : v.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
};

const SPEC = {
  expressions: [
    { expr: "x' = x*(1 - y)", phase: true, ic: [2], extraICs: [[0, 1.5, 1], ['0', '3', 1]], field: false },
    { expr: "y' = y*(x - 1)", ic: [1] },
    { expr: 'c = 0.5', min: 0, max: 2, family: true },
    { expr: "u' = 10*(v - u)", phase: true, phaseAxes: ['u', 'w'], ic: [1] },
    { expr: "v' = u*(28 - w) - v", ic: [1] },
    { expr: "w' = u*v - 8/3*w - c", ic: [1] },
  ],
  features: { equilibria: false },
};

const graph = (): GraphData => {
  const v = validateSpec(SPEC);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return specToGraph(v.spec);
};
const strip = (es: Entry[]) => es.map(({ id: _i, expanded: _x, ...e }) => e);

describe('ODE view options in the JSON spec', () => {
  it('validate and map onto entries / features', () => {
    const g = graph();
    expect(g.entries[0]).toMatchObject({ phase: true, field: false, extraICs: [[0, 1.5, 1], [0, 3, 1]] });
    expect(g.entries[2].family).toBe(true);
    expect(g.entries[3].phaseAxes).toEqual(['u', 'w']);
    expect(g.features.equilibria).toBe(false);
  });

  it('rejects bad values with paths and suggestions', () => {
    expect(errs({ expressions: [{ expr: "y' = y", phase: 'yes' }] })).toMatch(/expressions\[0\]\.phase: must be true or false/);
    expect(errs({ expressions: [{ expr: "y' = y", phaseAxes: ['x'] }] })).toMatch(/phaseAxes: must be two state names/);
    expect(errs({ expressions: [{ expr: "y' = y", phaseAxes: ['x', 'x'] }] })).toMatch(/two different/);
    expect(errs({ expressions: [{ expr: "y' = y", phaseAxes: ['x', '1+'] }] })).toMatch(/phaseAxes/);
    expect(errs({ expressions: [{ expr: "y' = y", extraICs: [1, 2] }] })).toMatch(/extraICs: must be a list/);
    expect(errs({ expressions: [{ expr: "y' = y", extraICs: [[1]] }] })).toMatch(/extraICs\[0\]: must be \[t0, y0/);
    expect(errs({ expressions: [{ expr: "y' = y", extraICs: [[0, 'q']] }] })).toMatch(/extraICs\[0\]\[1\]/);
    expect(errs({ expressions: [{ expr: "y' = y", extraICs: new Array(25).fill([0, 1]) }] })).toMatch(/at most 24/);
    expect(errs({ expressions: [{ expr: "y' = y", slopefield: true }] })).toMatch(/did you mean "field"/);
    expect(errs({ expressions: [{ expr: "y' = y", axes: ['x', 'y'] }] })).toMatch(/did you mean "phaseAxes"/);
    expect(errs({ expressions: ["y' = y"], features: { equilibria: 1 } })).toMatch(/features\.equilibria/);
  });

  it('round-trips through graphToSpec, share links and saved graphs', async () => {
    const g = graph();
    const spec = graphToSpec(g);
    expect(spec.features).toEqual({ equilibria: false });
    const v2 = validateSpec(spec);
    if (!v2.ok) throw new Error('invalid round trip');
    expect(strip(specToGraph(v2.spec).entries)).toEqual(strip(g.entries));
    // The app's share button → open it.
    const link = await buildShareLink(makeGraph(g), 'https://x.test/');
    const out = await loadFromUrl(new URL(link).hash, '');
    expect(strip(out!.graph!.entries)).toEqual(strip(g.entries));
    expect(out!.graph!.features.equilibria).toBe(false);
    // Files, legacy links and saved graphs go through sanitizeGraph.
    const json = JSON.parse(JSON.stringify(makeGraph(g)));
    expect(strip(sanitizeGraph(json).entries)).toEqual(strip(g.entries));
    expect(strip(sanitizeStored(json).entries)).toEqual(strip(g.entries));
    expect(sanitizeStored(json).features.equilibria).toBe(false);
  });

  it('sanitizeGraph drops malformed values', () => {
    const bad = {
      v: 1,
      entries: [
        {
          id: 'a',
          raw: "y' = y",
          color: '#c74440',
          visible: true,
          expanded: true,
          field: 'on',
          phase: 1,
          phaseAxes: ['x', 'y; drop'],
          extraICs: [[0, 1], [0], [0, 'x'], [0, 1e12], ...new Array(40).fill([1, 2])],
          family: 'yes',
        },
      ],
      viewport: { tMin: -8, tMax: 8, yMin: -5, yMax: 5 },
    } as unknown as GraphData;
    const e = sanitizeGraph(bad).entries[0];
    expect(e.field).toBeUndefined();
    expect(e.phase).toBeUndefined();
    expect(e.phaseAxes).toBeUndefined();
    expect(e.family).toBeUndefined();
    expect(e.extraICs).toHaveLength(24);
    expect(e.extraICs![0]).toEqual([0, 1]);
  });

  it('params links: field, phase, axes, family, equilibria', async () => {
    const link =
      "#expr=x'=x*(1-y)&phase=1&field=0&ic=2&expr=y'=y*(x-1)&ic=1&expr=c=1&family=1&expr=u'=v&phase=1&axes=u,v'&equilibria=off";
    const p = await readUrlPayload(link, '');
    expect(p.kind).toBe('spec');
    if (p.kind !== 'spec') return;
    expect(p.warnings).toEqual([]);
    const v = validateSpec(p.spec);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const g = specToGraph(v.spec);
    expect(g.entries[0]).toMatchObject({ phase: true, field: false });
    expect(g.entries[2].family).toBe(true);
    expect(g.entries[3].phaseAxes).toEqual(['u', "v'"]);
    expect(g.features.equilibria).toBe(false);
    // And back to params (no extraICs → representable).
    const back = specToParams(graphToSpec(g));
    expect(back).toContain('phase=1');
    expect(back).toContain('field=0');
    expect(back).toContain('family=1');
    expect(back).toContain('equilibria=off');
    const again = validateSpec(paramsToSpec(splitParams(back!, false)).spec);
    expect(again.ok && strip(specToGraph(again.spec).entries)).toEqual(strip(g.entries));
    // Extra solutions only travel as JSON.
    expect(specToParams({ expressions: [{ expr: "y' = y", extraICs: [[0, 1]] }] })).toBeNull();
  });
});

describe('docs cover the ODE view', () => {
  const text = JSON.stringify(SECTIONS);
  const llms = readFileSync(fileURLToPath(new URL('../../../public/llms.txt', import.meta.url)), 'utf8');
  it('user docs name every control', () => {
    for (const s of ['Slope field', 'Field & nullclines', '**phase**', 'Equilibria', 'Shift-click', 'Clear extra solutions', '**family**', 'Axes']) {
      expect(text).toContain(s);
    }
  });
  it('llms.txt documents every option', () => {
    for (const s of ['"field"', '"phase"', '"phaseAxes"', '"extraICs"', '"family"', '`equilibria`', 'axes=x,z']) expect(llms).toContain(s);
  });
});

describe('checkSpec: ODE view options', () => {
  const warn = (spec: unknown) => checkSpec(spec).warnings.map((w) => `${w.path}: ${w.message}`).join('\n');

  it('is quiet for valid use', () => {
    const r = checkSpec(SPEC);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('flags options that do not apply', () => {
    expect(warn({ expressions: [{ expr: 'y = x', phase: true, field: true }] })).toMatch(/phase only applies to ODEs/);
    expect(warn({ expressions: [{ expr: 'y = x', family: true }] })).toMatch(/family only applies to sliders/);
    expect(warn({ expressions: [{ expr: "y' = y", phase: true }] })).toMatch(/1-D state, so there is no phase plane/);
    expect(warn({ expressions: [{ expr: "y'' = -y", field: true }] })).toMatch(/a field needs a first-order equation/);
    expect(warn({ expressions: [{ expr: "y' = y", extraICs: [[0, 1, 2]] }] })).toMatch(/extraICs\[0\]: each extra solution is \[t0, …state\] with 2 numbers/);
    expect(
      warn({ expressions: [{ expr: "x' = -y", phase: true, phaseAxes: ['x', 'q'] }, "y' = x"] }),
    ).toMatch(/no state variable q/);
  });

  it('a phase-plane ODE is "visible" by its state-space curve', () => {
    const r = checkSpec({
      expressions: [{ expr: "x' = -y", phase: true, ic: [1] }, { expr: "y' = x", ic: [0] }],
      viewport: { xmin: 100, xmax: 110 },
    });
    expect(r.warnings.some((w) => /draws nothing/.test(w.message))).toBe(true);
    const ok = checkSpec({ expressions: [{ expr: "x' = -y", phase: true, ic: [1] }, { expr: "y' = x", ic: [0] }] });
    expect(ok.warnings).toEqual([]);
  });
});
