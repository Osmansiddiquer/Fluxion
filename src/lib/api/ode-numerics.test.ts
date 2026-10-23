import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSpec, specToGraph, graphToSpec, EXPRESSION_KEYS, DEFAULT_FEATURES, DEFAULT_PROJECTIONS, DEFAULT_VIEWPORT } from './spec';
import { paramsToSpec, specToParams, splitParams, buildShareLink } from './url';
import { loadFromUrl, sanitizeGraph } from './load';
import { checkSpec } from './check';
import { makeGraph, type GraphData } from '../graphFile';
import { GraphLibrary } from '../saved/library';
import { memoryKV } from '../saved/kv';
import { computeAll } from '../compute';
import type { Entry } from '../../store/types';

const BASE = 'https://osmansiddiquer.github.io/Fluxion/';
const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../public/fluxion-spec.schema.json', import.meta.url)), 'utf8'),
);

const numericsEntries: Entry[] = [
  { id: 'a', raw: "y'' + 0.5y' + 4y = delta(t - 1)", color: '#c74440', visible: true, expanded: true, ic: [0, 0], solver: 'auto', steps: 'heun', stepSize: 0.25 },
  { id: 'b', raw: "y'' = -y", color: '#2d70b3', visible: true, expanded: true, conditions: 'boundary', bc: [0, 0, Math.PI / 2, 1] },
  { id: 'c', raw: 'dy/dx = x - y, y(0) = 1', color: '#388c46', visible: true, expanded: false, solver: 'rk45' },
  { id: 'd', raw: "u' = -u + H(t - 2)", color: '#6042a6', visible: true, expanded: false, steps: 'euler' },
];
const graph: GraphData = makeGraph({
  entries: numericsEntries,
  viewport: DEFAULT_VIEWPORT,
  features: DEFAULT_FEATURES,
  projections: DEFAULT_PROJECTIONS,
  sigFigs: 3,
});

const strip = (es: Entry[]) => es.map(({ id: _i, expanded: _x, ...e }) => e);

describe('ODE numerics in the spec', () => {
  it('accepts solver / steps / h / conditions / bc and maps them onto entries', () => {
    const r = validateSpec({
      expressions: [
        { expr: "y'' = -y", solver: 'auto', steps: 'rk4', h: '1/4', conditions: 'boundary', bc: [0, 0, 'pi/2', 1] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = specToGraph(r.spec).entries[0];
    expect(e).toMatchObject({ solver: 'auto', steps: 'rk4', stepSize: 0.25, conditions: 'boundary' });
    expect(e.bc![2]).toBeCloseTo(Math.PI / 2);
  });
  it('rejects bad values with clear messages', () => {
    const bad = validateSpec({
      expressions: [
        { expr: "y' = y", solver: 'rk5' },
        { expr: "y' = y", steps: 'midpoint' },
        { expr: "y' = y", h: 0 },
        { expr: "y'' = y", bc: [0, 1, 0, 2] },
        { expr: "y'' = y", bc: [0, 1] },
        { expr: "y'' = y", conditions: 'final' },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const paths = bad.errors.map((e) => e.path);
    expect(paths).toEqual([
      'expressions[0].solver',
      'expressions[1].steps',
      'expressions[2].h',
      'expressions[3].bc',
      'expressions[4].bc',
      'expressions[5].conditions',
    ]);
  });
  it('suggests the key for common aliases', () => {
    const r = validateSpec({ expressions: [{ expr: "y' = y", integrator: 'auto', stepsize: 0.1 }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/did you mean "solver"/);
    expect(r.errors[1].message).toMatch(/did you mean "h"/);
  });
  it('graphToSpec ↔ specToGraph round-trips the fields', () => {
    const spec = graphToSpec(graph);
    const r = validateSpec(spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(strip(specToGraph(r.spec).entries)).toEqual(strip(numericsEntries));
  });
  it('the JSON schema lists every expression key (incl. the new ones)', () => {
    const props = Object.keys(schema.$defs.expression.properties);
    expect(props.sort()).toEqual([...EXPRESSION_KEYS].sort());
    expect(schema.$defs.expression.properties.solver.enum).toEqual(['auto', 'rk45', 'rk4', 'euler']);
    expect(schema.$defs.expression.properties.steps.enum).toEqual(['euler', 'heun', 'rk4']);
  });
});

describe('ODE numerics over links and storage', () => {
  it('params: solver, steps, h, conditions, bc', () => {
    const { spec, warnings } = paramsToSpec(
      splitParams("#expr=y''=-y&conditions=boundary&bc=0,0,pi/2,1&solver=auto&steps=heun&h=0.2", false),
    );
    expect(warnings).toEqual([]);
    const r = validateSpec(spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = specToGraph(r.spec).entries[0];
    expect(e).toMatchObject({ solver: 'auto', steps: 'heun', stepSize: 0.2, conditions: 'boundary' });
    // …and back to params.
    const q = specToParams(graphToSpec(specToGraph(r.spec)))!;
    expect(q).toContain('solver=auto');
    expect(q).toContain('bc=0,0,1.5707963267948966,1');
  });
  it('share link → loadFromUrl keeps everything', async () => {
    const link = await buildShareLink(graph, BASE);
    const u = new URL(link);
    const r = await loadFromUrl(u.hash, u.search);
    expect(r?.tone).toBe('info');
    expect(strip(r!.graph!.entries).map(({ color: _c, ...e }) => e)).toEqual(
      strip(numericsEntries).map(({ color: _c, ...e }) => e),
    );
  });
  it('sanitizeGraph keeps valid fields and drops bad ones', () => {
    const g = sanitizeGraph({
      ...graph,
      entries: [
        ...graph.entries,
        { id: 'x', raw: "y'' = y", color: '#000000', visible: true, expanded: true, solver: 'magic', steps: 'x', stepSize: -1, conditions: 'z', bc: [0, 1, 0, 1] } as unknown as Entry,
        { id: 'y', raw: "y'' = y", color: '#000000', visible: true, expanded: true, stepSize: 1e9, bc: [0, NaN, 1, 2] } as unknown as Entry,
      ],
    });
    expect(strip(g.entries.slice(0, 4))).toEqual(strip(numericsEntries));
    const x = g.entries[4];
    expect(x.solver).toBeUndefined();
    expect(x.steps).toBeUndefined();
    expect(x.stepSize).toBe(1e-3);
    expect(x.conditions).toBeUndefined();
    expect(x.bc).toBeUndefined();
    expect(g.entries[5].stepSize).toBe(100);
    expect(g.entries[5].bc).toBeUndefined();
  });
  it('saved graphs round-trip', async () => {
    const l = new GraphLibrary(memoryKV(), { now: () => 1, newId: () => 'g1' });
    const rec = await l.save({ name: 'Numerics', graph });
    const back = await l.toGraph(rec);
    expect(strip(back.entries)).toEqual(strip(numericsEntries));
    const res = computeAll(back.entries, back.viewport, 300);
    for (const e of back.entries) expect(res.get(e.id)!.error, e.raw).toBeUndefined();
  });
});

describe('checkSpec on numerics', () => {
  it('warns when numerics options are on non-ODE rows or not used', () => {
    const r = checkSpec({
      expressions: [
        { expr: 'y = x', solver: 'auto' },
        { expr: "y' = -y", conditions: 'boundary' },
        { expr: "y' = -y", h: 0.1 },
        { expr: "y'' = -y", bc: [0, 0, 1, 1] },
      ],
    });
    const msgs = r.warnings.map((w) => `${w.path}: ${w.message}`).join('\n');
    expect(msgs).toMatch(/expressions\[0\].*solver\/steps\/h only apply to ODEs/);
    expect(msgs).toMatch(/expressions\[1\].*conditions\/bc only apply to 2nd-order ODEs/);
    expect(msgs).toMatch(/expressions\[2\]\.h/);
    expect(msgs).toMatch(/expressions\[3\]\.bc/);
  });
  it('reports BVP failures as errors (no solution / not unique)', () => {
    const r = checkSpec({ expressions: ["y'' = -y, y(0) = 0, y(pi) = 0"] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/not unique/i);
    const ok = checkSpec({ expressions: ["y'' = -y, y(0) = 0, y(pi/2) = 1"] });
    expect(ok.ok).toBe(true);
    expect(ok.expressions[0].summary).toMatch(/2nd-order ODE in y\(t\) with y\(0\) = 0, y\(pi \/ 2\) = 1|with y\(0\) = 0, y\(pi\/2\) = 1/);
  });
});
