import { describe, expect, it, vi } from 'vitest';
import { rk4Step, isFiniteVec, maxAbs, type DerivFn } from './rk4';
import type { IntegrateOpts, Trajectory, TrajSegment } from './integrate';
import type { Entry, Viewport } from '../../store/types';

/**
 * Regression check for issue #3: with the default solver (RK4) every ODE the
 * app ships — docs examples, demos and the AGENTIC-TESTS seed — draws exactly
 * what it drew before (bit-identical), compared against the previous
 * integrator verbatim (origin/main before the numerics work).
 */
function legacyIntegrateSystem(deriv: DerivFn, opts: IntegrateOpts): Trajectory {
  const { t0, y0, tMin, tMax } = opts;
  const samples = opts.samples ?? 1500;
  const blowup = opts.blowup ?? 1e6;
  const span = tMax - tMin;
  const hWindow = span > 0 ? span / samples : 0.01;
  const STEP_CAP = 8000;
  const marchTo = (tStop: number): TrajSegment => {
    const dist = Math.abs(tStop - t0);
    if (dist < 1e-15) return { ts: [t0], ys: [y0.slice()] };
    const steps = Math.min(STEP_CAP, Math.max(8, Math.ceil(dist / hWindow)));
    const h = (tStop - t0) / steps;
    const ts: number[] = [t0];
    const ys: number[][] = [y0.slice()];
    let t = t0;
    let y = y0.slice();
    for (let i = 0; i < steps; i++) {
      const next = rk4Step(deriv, t, y, h);
      t += h;
      if (!isFiniteVec(next) || maxAbs(next) > blowup) break;
      y = next;
      ts.push(t);
      ys.push(y.slice());
    }
    return { ts, ys };
  };
  const fwd = t0 < tMax ? marchTo(tMax) : { ts: [t0], ys: [y0.slice()] };
  const bwd = t0 > tMin ? marchTo(tMin) : { ts: [t0], ys: [y0.slice()] };
  const ts: number[] = [];
  const ys: number[][] = [];
  for (let i = bwd.ts.length - 1; i >= 0; i--) {
    ts.push(bwd.ts[i]);
    ys.push(bwd.ys[i]);
  }
  for (let i = 1; i < fwd.ts.length; i++) {
    ts.push(fwd.ts[i]);
    ys.push(fwd.ys[i]);
  }
  if (ts.length < 2) return [];
  return [{ ts, ys }];
}

interface G {
  name: string;
  entries: Entry[];
  viewport: Viewport;
}

async function shippedOdeGraphs(): Promise<G[]> {
  const { parseEntry } = await import('../math/parse');
  const { allExamples } = await import('../../components/Docs/content');
  const { exampleGraph } = await import('../../components/Docs/examples');
  const { DEMOS } = await import('../demos');
  const out: G[] = [
    {
      name: 'AGENTIC-TESTS seed',
      viewport: { tMin: -8, tMax: 8, yMin: -5, yMax: 5 },
      entries: [
        { id: '1', raw: "y' = y", color: '#c74440', visible: true, expanded: true, t0: 0, ic: [1] },
        { id: '2', raw: "y'' = -y", color: '#2d70b3', visible: true, expanded: false, t0: 0, ic: [0, 1] },
      ],
    },
  ];
  // Only rows the old app could express (no new notation / numerics options).
  const legacyRow = (e: Entry) => {
    const p = parseEntry(e.raw);
    if (p.kind === 'condition') return false;
    if (p.kind !== 'ode') return true;
    return !p.conds && !p.impulses && !p.breaks && !p.indep && !p.xAlt && !e.solver && !e.steps && !e.conditions;
  };
  for (const { example } of allExamples()) {
    if (example.demo) continue;
    const g = exampleGraph(example);
    if (!g.entries.some((e) => parseEntry(e.raw).kind === 'ode') || !g.entries.every(legacyRow)) continue;
    out.push({ name: example.title, entries: g.entries, viewport: g.viewport });
  }
  for (const d of DEMOS) {
    const g = d.build();
    if (!g.entries.some((e) => parseEntry(e.raw).kind === 'ode') || !g.entries.every(legacyRow)) continue;
    out.push({ name: `demo ${d.id}`, entries: g.entries, viewport: g.viewport });
  }
  return out;
}

const curvesOf = async (legacy: boolean, graphs: G[]) => {
  vi.resetModules();
  if (legacy) {
    vi.doMock('./integrate', async (orig) => ({ ...(await orig<typeof import('./integrate')>()), integrateSystem: legacyIntegrateSystem }));
  } else {
    vi.doUnmock('./integrate');
  }
  const { computeAll } = await import('../compute');
  const { parseEntry } = await import('../math/parse');
  return graphs.map((g) => {
    const res = computeAll(g.entries, g.viewport, 1500);
    return g.entries.filter((e) => parseEntry(e.raw).kind === 'ode').map((e) => res.get(e.id)!.curve.segments);
  });
};

describe('default solver regression (every shipped ODE renders the same)', () => {
  it('docs examples, demos and the AGENTIC-TESTS seed are bit-identical to the previous RK4', async () => {
    const graphs = await shippedOdeGraphs();
    expect(graphs.length).toBeGreaterThan(10);
    const before = await curvesOf(true, graphs);
    const after = await curvesOf(false, graphs);
    graphs.forEach((g, i) => {
      expect(after[i].length, g.name).toBe(before[i].length);
      expect(after[i], g.name).toEqual(before[i]);
      expect(after[i].flat(2).length, g.name).toBeGreaterThan(0);
    });
  }, 60000);
});
