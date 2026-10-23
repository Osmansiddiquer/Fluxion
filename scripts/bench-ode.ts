/**
 * ODE solver benchmark (issue #3): every ODE graph the app ships — the docs
 * examples, the demos and the AGENTIC-TESTS seed — solved with each integrator.
 * Accuracy is the max |y − y_ref| over the visible samples, relative to the
 * viewport height; y_ref is DOPRI5 at rtol 1e-13 sampled 16× as densely. Time is the
 * median of `runs` cold solves (the viewport shifts by 1e-9 each run so the
 * ODE group cache misses, as on a real pan).
 *
 *   npx vite-node scripts/bench-ode.ts            # table
 *   npx vite-node scripts/bench-ode.ts -- json    # machine-readable
 */
import { computeAll } from '../src/lib/compute';
import { parseEntry } from '../src/lib/math/parse';
import { allExamples } from '../src/components/Docs/content';
import { exampleGraph } from '../src/components/Docs/examples';
import { DEMOS } from '../src/lib/demos';
import { registerAssets } from '../src/lib/frames/assets';
import type { Entry, Viewport } from '../src/store/types';
import { TOLERANCES, type SolverMethod } from '../src/lib/solver/integrate';

const SAMPLES = 1500;
const RUNS = 31;
const METHODS: SolverMethod[] = ['auto', 'rk45', 'rk4', 'euler'];

interface Graph {
  name: string;
  entries: Entry[];
  viewport: Viewport;
}

const AGENTIC: Graph = {
  name: 'AGENTIC-TESTS seed',
  viewport: { tMin: -8, tMax: 8, yMin: -5, yMax: 5 },
  entries: [
    { id: '1', raw: "y' = y", color: '#c74440', visible: true, expanded: true, t0: 0, ic: [1] },
    { id: '2', raw: "y'' = -y", color: '#2d70b3', visible: true, expanded: false, t0: 0, ic: [0, 1] },
  ],
};

function graphs(): Graph[] {
  const out: Graph[] = [AGENTIC];
  const seen = new Set<string>();
  for (const { example: ex } of allExamples()) {
    let g;
    if (ex.demo) {
      const d = DEMOS.find((x) => x.id === ex.demo);
      if (!d) continue;
      g = d.build();
      registerAssets(g.assets);
    } else g = exampleGraph(ex);
    const hasOde = g.entries.some((e) => parseEntry(e.raw).kind === 'ode');
    const key = g.entries.map((e) => e.raw).join('|');
    if (!hasOde || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: ex.title ?? g.entries.find((e) => parseEntry(e.raw).kind === 'ode')!.raw, entries: g.entries, viewport: g.viewport });
  }
  for (const d of DEMOS) {
    const g = d.build();
    if (!g.entries.some((e) => parseEntry(e.raw).kind === 'ode')) continue;
    registerAssets(g.assets);
    out.push({ name: `demo: ${d.id}`, entries: g.entries, viewport: g.viewport });
  }
  return out;
}

const odeIds = (g: Graph) => g.entries.filter((e) => parseEntry(e.raw).kind === 'ode').map((e) => e.id);
const withSolver = (g: Graph, m: SolverMethod): Entry[] =>
  g.entries.map((e) => (parseEntry(e.raw).kind === 'ode' ? { ...e, solver: m } : e));

function interp(seg: [number, number][], t: number): number {
  let lo = 0;
  let hi = seg.length - 1;
  if (t < seg[0][0] || t > seg[hi][0]) return NaN;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (seg[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, y0] = seg[lo];
  const [t1, y1] = seg[hi];
  return t1 === t0 ? y1 : y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
}

const tolArg = process.argv.find((a) => a.startsWith('tol='));
const DRAW_TOL = tolArg ? { rtol: Number(tolArg.slice(4).split(',')[0]), atol: Number(tolArg.slice(4).split(',')[1]) } : { ...TOLERANCES };

function reference(g: Graph) {
  Object.assign(TOLERANCES, { rtol: 1e-13, atol: 1e-15 });
  const vp = { ...g.viewport, tMin: g.viewport.tMin - 1e-7 };
  const ref = computeAll(withSolver(g, 'rk45'), vp, SAMPLES * 16);
  Object.assign(TOLERANCES, DRAW_TOL);
  return ref;
}

function measure(g: Graph, m: SolverMethod) {
  const entries = withSolver(g, m);
  const ref = reference(g);
  const times: number[] = [];
  let res = computeAll(entries, g.viewport, SAMPLES);
  for (let i = 0; i < RUNS; i++) {
    const vp = { ...g.viewport, tMax: g.viewport.tMax + (i + 1) * 1e-9 };
    const t0 = performance.now();
    res = computeAll(entries, vp, SAMPLES);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const span = g.viewport.yMax - g.viewport.yMin;
  let err = 0;
  let fevals = 0;
  for (const id of odeIds(g)) {
    const r = res.get(id)!;
    const rr = ref.get(id)!;
    fevals += r.numerics?.stats.fevals ?? 0;
    for (const seg of r.curve.segments) {
      for (const [t, y] of seg) {
        // Only what's on screen matters (and the reference is only exact there).
        if (Math.abs(y) > Math.max(Math.abs(g.viewport.yMin), Math.abs(g.viewport.yMax)) * 2) continue;
        for (const rs of rr.curve.segments) {
          const v = interp(rs as [number, number][], t);
          if (Number.isFinite(v)) err = Math.max(err, Math.abs(v - y) / span);
        }
      }
    }
    if (r.error) err = Infinity;
  }
  return { ms: times[Math.floor(times.length / 2)], err, fevals };
}

const rows = graphs().map((g) => {
  const cells: Record<string, { ms: number; err: number; fevals: number }> = {};
  for (const m of METHODS) cells[m] = measure(g, m);
  return { name: g.name, cells };
});

if (process.argv.includes('json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const f = (x: number) => (x === 0 ? '0' : x.toExponential(1));
  console.log(`| Graph | ${METHODS.map((m) => `${m} ms · err · f-evals`).join(' | ')} |`);
  console.log(`| --- | ${METHODS.map(() => '---').join(' | ')} |`);
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${METHODS.map((m) => `${r.cells[m].ms.toFixed(2)} · ${f(r.cells[m].err)} · ${r.cells[m].fevals}`).join(' | ')} |`,
    );
  }
  const tot = (m: SolverMethod, k: 'ms' | 'fevals') => rows.reduce((s, r) => s + r.cells[m][k], 0);
  const worst = (m: SolverMethod) => Math.max(...rows.map((r) => r.cells[m].err));
  console.log(`| **total / worst** | ${METHODS.map((m) => `${tot(m, 'ms').toFixed(2)} · ${f(worst(m))} · ${tot(m, 'fevals')}`).join(' | ')} |`);
}
