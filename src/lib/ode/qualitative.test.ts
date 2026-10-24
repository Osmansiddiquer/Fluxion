import { describe, expect, it, beforeEach } from 'vitest';
import { computeAll } from '../compute';
import type { Entry, Viewport } from '../../store/types';
import { clearOdeOverlayCaches, odeCacheStats, stateAt, trajectoryComputeCount } from './overlays';
import {
  addExtraIC,
  extraFromClick,
  familyValues,
  groupView,
  icDragPatches,
  MAX_EXTRA_ICS,
  stateLabel,
  stateName,
  stateSymbol,
} from './view';
import { computeSignature } from '../../state/signature';
import { callsOf } from '../compute';
import { parseEntry, type Parsed } from '../math/parse';
import { isDerived } from '../scope';
import { buildSystem } from '../math/reduce';
import { integrateSystem } from '../solver/integrate';
import { componentCurve } from './overlays';
import { familyApplies, snapToPixel } from './view';
import { DEMOS, EXPRESSION_DEMOS } from '../demos';
import { registerAssets } from '../frames/assets';

const VP: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${++n}`,
  raw,
  color: '#c74440',
  visible: true,
  expanded: true,
  ...extra,
});

beforeEach(() => clearOdeOverlayCaches());

describe('slope field', () => {
  it('is off by default (opt-in)', () => {
    const a = E("y' = y - t");
    const o = computeAll([a], VP).get(a.id)!.ode!;
    expect(o.fieldKind).toBe('slope');
    expect(o.fieldOn).toBe(false);
    expect(o.field).toBeUndefined();
  });

  it('field: true samples f(t, y)', () => {
    const a = E("y' = y - t", { field: true });
    const r = computeAll([a], VP).get(a.id)!;
    const f = r.ode!.field!;
    expect(f.kind).toBe('slope');
    expect(f.count).toBeGreaterThan(200);
    for (let i = 0; i < f.count; i++) {
      const [t, y, ux, uy] = [f.data[i * 5], f.data[i * 5 + 1], f.data[i * 5 + 2], f.data[i * 5 + 3]];
      expect(Math.hypot(ux, uy)).toBeCloseTo(1, 9);
      expect(uy / ux).toBeCloseTo(y - t, 6);
    }
  });

  it('grid follows the zoom and snaps to nice multiples', () => {
    const a = E("y' = -y", { field: true });
    const f1 = computeAll([a], VP).get(a.id)!.ode!.field!;
    const f2 = computeAll([a], { tMin: -80, tMax: 80, yMin: -50, yMax: 50 }).get(a.id)!.ode!.field!;
    expect(f2.spacing / f1.spacing).toBeCloseTo(10, 9);
    // Grid points sit at odd multiples of half the spacing (pan-stable).
    const x0 = f1.data[0] / (f1.spacing / 2);
    expect(Math.abs(x0 - Math.round(x0))).toBeLessThan(1e-9);
  });

  it('field: true/false per row; no automatic slope field', () => {
    const a = E("y' = y");
    const b = E("y' = -y");
    let res = computeAll([a, b], VP);
    expect(res.get(a.id)!.ode!.field).toBeUndefined();
    expect(res.get(b.id)!.ode!.field).toBeUndefined();
    a.field = true;
    b.field = true;
    res = computeAll([a, b], VP);
    expect(res.get(a.id)!.ode!.fieldOn).toBe(true);
    expect(res.get(b.id)!.ode!.fieldOn).toBe(true);
    a.field = false;
    res = computeAll([a, b], VP);
    expect(res.get(a.id)!.ode!.field).toBeUndefined();
    expect(res.get(b.id)!.ode!.field).toBeDefined();
  });

  it('has no field for higher-order equations or systems against t', () => {
    const a = E("y'' = -y");
    const x = E("x' = -y");
    const y = E("y' = x");
    const res = computeAll([a, x, y], VP);
    expect(res.get(a.id)!.ode!.fieldKind).toBeUndefined();
    expect(res.get(x.id)!.ode!.fieldKind).toBeUndefined();
  });
});

describe('state names', () => {
  it('round-trips internal symbols and typed names', () => {
    expect(stateName('D1_y')).toBe("y'");
    expect(stateName('D2_y')).toBe("y''");
    expect(stateSymbol("y'")).toBe('D1_y');
    expect(stateSymbol('y′')).toBe('D1_y');
    expect(stateSymbol('z')).toBe('z');
    expect(stateLabel('D1_y')).toBe('y′');
  });
});

describe('phase plane', () => {
  it('extracts (x, y) for a 2-D system', () => {
    const x = E("x' = x - x*y", { phase: true, ic: [2] });
    const y = E("y' = x*y - y", { ic: [1] });
    const res = computeAll([x, y], VP);
    const lx = res.get(x.id)!.ode!;
    expect(lx.isLeader).toBe(true);
    expect(lx.phase!.labels).toEqual(['x', 'y']);
    const seg = lx.phase!.curve!.segments[0];
    // Lotka–Volterra conserves V = x − ln x + y − ln y.
    const V = (p: [number, number]) => p[0] - Math.log(p[0]) + p[1] - Math.log(p[1]);
    const v0 = V([2, 1]);
    for (const p of seg) expect(V(p)).toBeCloseTo(v0, 5);
    // The other member draws no phase curve of its own.
    expect(res.get(y.id)!.ode!.phase!.curve).toBeUndefined();
    // Components vs t stay available (cross-section panels).
    expect(res.get(x.id)!.curve.segments.length).toBeGreaterThan(0);
  });

  it('reads a second-order equation as (y, y′)', () => {
    const p = E("y'' = -y", { phase: true, ic: [1, 0] });
    const r = computeAll([p], VP).get(p.id)!;
    expect(r.ode!.phase!.labels).toEqual(['y', 'y′']);
    for (const q of r.ode!.phase!.curve!.segments[0]) expect(Math.hypot(q[0], q[1])).toBeCloseTo(1, 6);
  });

  it('is ignored for a 1-D state, and picks two axes of a 3-D system', () => {
    const a = E("y' = y", { phase: true });
    expect(computeAll([a], VP).get(a.id)!.ode!.phase).toBeUndefined();
    expect(groupView([a], ['y']).phase).toBe(false);
    const x = E("x' = 10*(y - x)", { phase: true, phaseAxes: ['x', 'z'], ic: [1] });
    const y = E("y' = x*(28 - z) - y", { ic: [1] });
    const z = E("z' = x*y - 8/3*z", { ic: [1] });
    const res = computeAll([x, y, z], { tMin: -30, tMax: 30, yMin: -5, yMax: 55 });
    const ph = res.get(x.id)!.ode!.phase!;
    expect(ph.labels).toEqual(['x', 'z']);
    expect(ph.axes).toEqual([0, 2]);
    // The Lorenz attractor lives at z ≈ 0…50.
    const zs = ph.curve!.segments.flat().map((q) => q[1]);
    expect(Math.max(...zs)).toBeGreaterThan(30);
    // No vector field / equilibria for a projected 3-D state.
    expect(res.get(x.id)!.ode!.field).toBeUndefined();
    expect(res.get(x.id)!.ode!.equilibria).toBeUndefined();
  });

  it('integrates a fixed window around t0, independent of the viewport', () => {
    const p = E("y'' = -y", { phase: true, ic: [1, 0] });
    const a = computeAll([p], VP).get(p.id)!;
    const b = computeAll([p], { tMin: -1, tMax: 1, yMin: -1, yMax: 1 }).get(p.id)!;
    expect(b.ode!.phase!.curve).toBe(a.ode!.phase!.curve);
  });

  it('draws nullclines on the vector field (Lotka–Volterra)', () => {
    const x = E("x' = x*(1 - y)", { phase: true, ic: [2] });
    const y = E("y' = y*(x - 1)", { ic: [1] });
    const info = computeAll([x, y], { tMin: -1, tMax: 4, yMin: -1, yMax: 4 }).get(x.id)!.ode!;
    expect(info.field!.kind).toBe('vector');
    const [nx, ny] = info.nullclines!;
    // x' = 0 on x = 0 and y = 1; y' = 0 on y = 0 and x = 1.
    const onX = (p: [number, number]) => Math.abs(p[0]) < 1e-6 || Math.abs(p[1] - 1) < 1e-6;
    const onY = (p: [number, number]) => Math.abs(p[1]) < 1e-6 || Math.abs(p[0] - 1) < 1e-6;
    expect(nx.segments.length).toBeGreaterThan(10);
    for (const s of nx.segments) for (const p of s) expect(onX(p)).toBe(true);
    for (const s of ny.segments) for (const p of s) expect(onY(p)).toBe(true);
  });

  it('pendulum nullclines: y′ = 0 and sin(y) = 0', () => {
    const p = E("y'' = -sin(y)", { phase: true, ic: [1, 0] });
    const info = computeAll([p], { tMin: -4, tMax: 4, yMin: -3, yMax: 3 }).get(p.id)!.ode!;
    const [n0, n1] = info.nullclines!;
    for (const s of n0.segments) for (const q of s) expect(Math.abs(q[1])).toBeLessThan(1e-6);
    for (const s of n1.segments) for (const q of s) expect(Math.abs(Math.sin(q[0]))).toBeLessThan(1e-3);
    const xs = new Set(n1.segments.flat().map((q) => Math.round(q[0] / Math.PI)));
    expect([...xs].sort()).toEqual([-1, 0, 1]);
  });
});

describe('equilibria', () => {
  const eqs = (entries: Entry[], vp: Viewport = VP) => computeAll(entries, vp).get(entries[0].id)!.ode!.equilibria!;

  it('1-D: stable / unstable / semi-stable', () => {
    const r = eqs([E("y' = y*(1 - y)")]);
    expect(r.mode).toBe('lines');
    expect(r.list.map((e) => [e.point[0], e.stability])).toEqual([
      [0, 'unstable'],
      [1, 'stable'],
    ]);
    expect(r.list[0].slope).toBeCloseTo(1, 6);
    expect(r.list[1].slope).toBeCloseTo(-1, 6);
    const semi = eqs([E("y' = (y - 1)^2")]);
    expect(semi.list).toHaveLength(1);
    expect(semi.list[0].point[0]).toBeCloseTo(1, 6);
    expect(semi.list[0].stability).toBe('semi-stable');
  });

  it('rejects non-autonomous equations', () => {
    const r = eqs([E("y' = y - t")]);
    expect(r.autonomous).toBe(false);
    expect(r.list).toEqual([]);
  });

  it('2-D: saddle, nodes, spirals and centre', () => {
    const sys = (f: string, g: string) => {
      const x = E(`x' = ${f}`, { phase: true });
      const y = E(`y' = ${g}`);
      return eqs([x, y]).list;
    };
    expect(sys('y', 'x')[0].type).toBe('saddle');
    expect(sys('-2x + y', 'x - 2y')[0].type).toBe('stable node');
    expect(sys('2x + y', 'x + 2y')[0].type).toBe('unstable node');
    expect(sys('-x + y', '-x - y')[0].type).toBe('stable spiral');
    expect(sys('x + y', '-x + y')[0].type).toBe('unstable spiral');
    expect(sys('y', '-x')[0].type).toBe('centre');
    const s = sys('-x + y', '-x - y')[0];
    expect(s.eigenvalues![0].re).toBeCloseTo(-1, 9);
    expect(Math.abs(s.eigenvalues![0].im)).toBeCloseTo(1, 9);
    expect(s.jacobian).toEqual([
      [-1, 1],
      [-1, -1],
    ]);
  });

  it('Lotka–Volterra: a saddle at the origin and a centre at (1, 1)', () => {
    const x = E("x' = x*(1 - y)", { phase: true });
    const y = E("y' = y*(x - 1)");
    const list = eqs([x, y], { tMin: -1, tMax: 4, yMin: -1, yMax: 4 }).list;
    expect(list.map((e) => [e.point.map((v) => Math.round(v * 1e6) / 1e6), e.type])).toEqual([
      [[0, 0], 'saddle'],
      [[1, 1], 'centre'],
    ]);
    // Newton is polished to round-off: clean points and Jacobians for the tooltip.
    expect(list[0].point).toEqual([0, 0]);
    expect(list[1].jacobian).toEqual([
      [0, -1],
      [1, 0],
    ]);
  });

  it('pendulum: centres at 2kπ, saddles at (2k+1)π; also as y = c lines against t', () => {
    const p = E("y'' = -sin(y)", { phase: true });
    const list = eqs([p], { tMin: -4, tMax: 4, yMin: -3, yMax: 3 }).list;
    expect(list.map((e) => [Math.round(e.point[0] / Math.PI), e.type])).toEqual([
      [-1, 'saddle'],
      [0, 'centre'],
      [1, 'saddle'],
    ]);
    const damped = eqs([E("y'' = -sin(y) - 0.5y'", { phase: true })], { tMin: -1, tMax: 1, yMin: -1, yMax: 1 });
    expect(damped.list[0].type).toBe('stable spiral');
    const vt = eqs([E("y'' = -sin(y)")], { tMin: -8, tMax: 8, yMin: -4, yMax: 4 });
    expect(vt.mode).toBe('lines');
    expect(vt.list.map((e) => Math.round(e.point[0] / Math.PI))).toEqual([-1, 0, 1]);
  });

  it('uses slider values and a numeric Jacobian when needed', () => {
    const k = E('k = 2');
    const x = E("x' = abs(x) - k", { phase: true });
    const y = E("y' = x - 2y");
    const list = computeAll([x, y, k], VP).get(x.id)!.ode!.equilibria!.list;
    expect(list.map((e) => [Math.round(e.point[0] * 1e6) / 1e6, e.type])).toEqual([
      [-2, 'stable node'],
      [2, 'saddle'],
    ]);
  });
});

describe('IC drag (pure)', () => {
  it('vs t: moves t0 on the leader and the value on the owner', () => {
    const a = E("y'' = -y", { ic: [1, 0.5], t0: 0 });
    const patches = icDragPatches(
      { mode: 't', leaderId: a.id, owner: { entryId: a.id, k: 0, order: 2 } },
      1.5,
      -2,
      [a],
    );
    expect(patches).toEqual([{ id: a.id, patch: { t0: 1.5, ic: [-2, 0.5] } }]);
  });

  it('phase: edits the two plotted components (one row or two)', () => {
    const p = E("y'' = -y", { ic: [1, 0] });
    expect(
      icDragPatches(
        { mode: 'phase', owners: [{ entryId: p.id, k: 0, order: 2 }, { entryId: p.id, k: 1, order: 2 }] },
        3,
        4,
        [p],
      ),
    ).toEqual([{ id: p.id, patch: { ic: [3, 4] } }]);
    const x = E("x' = -y");
    const y = E("y' = x", { ic: [7] });
    expect(
      icDragPatches(
        { mode: 'phase', owners: [{ entryId: x.id, k: 0, order: 1 }, { entryId: y.id, k: 0, order: 1 }] },
        3,
        4,
        [x, y],
      ),
    ).toEqual([
      { id: x.id, patch: { ic: [3] } },
      { id: y.id, patch: { ic: [4] } },
    ]);
  });

  it('IC info places the dot and dragging re-integrates only that trajectory', () => {
    const a = E("y' = y*(1 - y)", { ic: [0.5], t0: 1 });
    const r = computeAll([a], VP).get(a.id)!;
    expect(r.ode!.ic!.pos).toEqual([1, 0.5]);
    const field = r.ode!.field;
    const eq = r.ode!.equilibria;
    const r2 = computeAll([{ ...a, ic: [0.25] }], VP).get(a.id)!;
    expect(r2.ode!.ic!.pos).toEqual([1, 0.25]);
    // The field and equilibria don't depend on the IC: served from the cache.
    expect(r2.ode!.field).toBe(field);
    expect(r2.ode!.equilibria).toBe(eq);
  });
});

describe('extra solutions', () => {
  it('builds the IC from a shift-click', () => {
    expect(extraFromClick({ phase: false, axes: [0, 1] }, 0, [1, 0.5], 2, 3)).toEqual([2, 3, 0.5]);
    expect(extraFromClick({ phase: true, axes: [1, 0] }, 0.5, [1, 0], 2, 3)).toEqual([0.5, 3, 2]);
    let list: number[][] | undefined;
    for (let i = 0; i < MAX_EXTRA_ICS + 3; i++) list = addExtraIC(list, [i, i]);
    expect(list).toHaveLength(MAX_EXTRA_ICS);
    expect(list![0]).toEqual([3, 3]);
  });

  it('integrates each extra and caches them separately', () => {
    const a = E("y' = -y", { extraICs: [[0, 2], [1, -1]] });
    const before = trajectoryComputeCount();
    const r = computeAll([a], VP).get(a.id)!;
    expect(r.ode!.extras).toHaveLength(2);
    // y = 2e^{-t} through (0, 2).
    for (const [t, y] of r.ode!.extras![0].segments[0]) expect(y / (2 * Math.exp(-t))).toBeCloseTo(1, 6);
    expect(trajectoryComputeCount() - before).toBe(2);
    // Dragging the main IC doesn't re-integrate the extras.
    computeAll([{ ...a, ic: [3] }], VP);
    expect(trajectoryComputeCount() - before).toBe(2);
    // Adding one integrates just the new one.
    computeAll([{ ...a, extraICs: [[0, 2], [1, -1], [0, 4]] }], VP);
    expect(trajectoryComputeCount() - before).toBe(3);
    // Malformed entries (wrong dimension) are skipped.
    expect(computeAll([{ ...a, extraICs: [[0, 1, 2]] }], VP).get(a.id)!.ode!.extras).toBeUndefined();
  });

  it("extras use the row's solver and forcing (impulses), keyed by the solver", () => {
    const a = E("y' = -y + 2delta(t - 3)", { ic: [1], extraICs: [[0, 0]] });
    const r = computeAll([a], VP).get(a.id)!;
    const pts = r.ode!.extras!.flatMap((c) => c.segments.flat());
    // The extra from y(0) = 0 jumps by 2 at t = 3: 0 before, 2e^{-(t-3)} after.
    const after = pts.find((p) => p[0] > 3.5)!;
    expect(after[1]).toBeCloseTo(2 * Math.exp(-(after[0] - 3)), 4);
    expect(pts.find((p) => p[0] > 1 && p[0] < 2.5)![1]).toBeCloseTo(0, 9);
    // Euler gives a visibly different extra (a separate cache entry).
    const b = { ...a, raw: "y' = -y", extraICs: [[0, 1]] };
    const rk4 = computeAll([b], VP).get(b.id)!.ode!.extras![0];
    const eu = computeAll([{ ...b, solver: 'euler' as const }], VP).get(b.id)!.ode!.extras![0];
    const at = (c: typeof rk4, t: number) => c.segments.flat().find((p) => p[0] >= t)![1];
    expect(at(rk4, 4)).toBeCloseTo(Math.exp(-4), 6);
    expect(Math.abs(at(eu, 4) - Math.exp(-4))).toBeGreaterThan(1e-5);
  });

  it('phase mode honours typed conditions and the solver', () => {
    const p = E("y'' = -y, y(0) = 2, y'(0) = 0", { phase: true, solver: 'auto' });
    const r = computeAll([p], VP).get(p.id)!;
    expect(r.ode!.y0).toEqual([2, 0]);
    // Typed conditions fix the start: no draggable ring.
    expect(r.ode!.ic).toBeUndefined();
    expect(r.numerics!.solver).toBe('auto');
    for (const q of r.ode!.phase!.curve!.segments[0]) expect(Math.hypot(q[0], q[1])).toBeCloseTo(2, 5);
  });

  it('phase extras are state-space curves on the leader', () => {
    const x = E("x' = -y", { phase: true, extraICs: [[0, 2, 0]] });
    const y = E("y' = x");
    const r = computeAll([x, y], VP).get(x.id)!;
    expect(r.ode!.extras).toHaveLength(1);
    for (const q of r.ode!.extras![0].segments[0]) expect(Math.hypot(q[0], q[1])).toBeCloseTo(2, 5);
  });

  it('extra ICs count in the compute signature', () => {
    const a = E("y' = -y");
    expect(computeSignature([{ ...a, extraICs: [[0, 1]] }])).not.toBe(computeSignature([a]));
    expect(computeSignature([{ ...a, phase: true }])).not.toBe(computeSignature([a]));
    expect(computeSignature([{ ...a, field: false }])).not.toBe(computeSignature([a]));
    const k = E('k = 1');
    expect(computeSignature([{ ...k, family: true }])).not.toBe(computeSignature([k]));
    // Bounds only matter while the family is on.
    expect(computeSignature([{ ...k, varMax: 3 }])).toBe(computeSignature([k]));
    expect(computeSignature([{ ...k, family: true, varMax: 3 }])).not.toBe(computeSignature([{ ...k, family: true }]));
  });
});

describe('parameter families', () => {
  it('evenly spaced values across the range', () => {
    expect(familyValues(0, 3, 4)).toEqual([0, 1, 2, 3]);
    expect(familyValues(1, 1)).toEqual([1]);
  });

  it('ghosts a function for each value and caches each one', () => {
    const k = E('k = 1', { family: true, varMin: 0, varMax: 3 });
    const f = E('y = k*sin(x)');
    const g = E('y = cos(x)');
    const res = computeAll([k, f, g], VP);
    const gh = res.get(f.id)!.ghosts!;
    expect(gh).toHaveLength(7);
    expect(gh.map((x) => x.u)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
    // Amplitude of the last ghost is 3.
    const ys = gh[6].curve.segments.flat().map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(3, 2);
    // Unrelated rows get none.
    expect(res.get(g.id)!.ghosts).toBeUndefined();
    const before = odeCacheStats().family;
    expect(before).toBe(7);
    // Moving the slider itself doesn't change the ghosts (same values).
    const res2 = computeAll([{ ...k, varValue: 2 }, f, g], VP);
    expect(res2.get(f.id)!.ghosts![3].curve).toBe(gh[3].curve);
  });

  it('follows derived values and ODEs (damping family)', () => {
    const c = E('c = 0.5', { family: true, varMin: 0, varMax: 3 });
    const d = E('b = 2c');
    const o = E("y'' = -b*y' - y", { ic: [1, 0] });
    const r = computeAll([c, d, o], VP).get(o.id)!;
    expect(r.ghosts).toHaveLength(7);
    // c = 0 (first ghost) is undamped: y = cos t.
    for (const [t, y] of r.ghosts![0].curve.segments[0]) expect(y).toBeCloseTo(Math.cos(t), 4);
    // The family off: no ghosts.
    expect(computeAll([{ ...c, family: false }, d, o], VP).get(o.id)!.ghosts).toBeUndefined();
  });

  it('phase-plane families ghost the state-space curve', () => {
    const c = E('c = 0.5', { family: true, varMin: 0, varMax: 1 });
    const o = E("y'' = -c*y' - y", { ic: [1, 0], phase: true });
    const r = computeAll([c, o], VP).get(o.id)!;
    expect(r.ghosts).toHaveLength(7);
    for (const q of r.ghosts![0].curve.segments[0]) expect(Math.hypot(q[0], q[1])).toBeCloseTo(1, 4);
  });
});

describe('family switch visibility', () => {
  const items = (rows: string[]) =>
    rows.map((raw) => {
      const p = parseEntry(raw);
      return {
        kind: p.kind,
        name: 'name' in p ? (p as { name?: string }).name : undefined,
        deps: 'deps' in p ? (p as { deps: string[] }).deps : undefined,
        calls: [...callsOf(p)],
        derived: (isDerived as (x: Parsed) => boolean)(p),
      };
    });
  it('appears only when a function or ODE depends on the slider', () => {
    expect(familyApplies('k', items(['k = 1', 'y = k*x']))).toBe(true);
    expect(familyApplies('k', items(['k = 1', "y' = -k*y"]))).toBe(true);
    expect(familyApplies('k', items(['k = 1', 'y = x^2']))).toBe(false);
    // Through a derived value and a user function.
    expect(familyApplies('k', items(['k = 1', 'b = 2k', 'y = b*x']))).toBe(true);
    expect(familyApplies('k', items(['k = 1', 'f(u) = k*u', 'y = f(x)']))).toBe(true);
    // A point or a derived value alone can't be ghosted.
    expect(familyApplies('k', items(['k = 1', 'b = 2k', 'A = (k, 1)']))).toBe(false);
  });
});

describe('snapToPixel', () => {
  it('rounds to the screen resolution', () => {
    expect(snapToPixel(0.6199998, 0.018)).toBe(0.62);
    expect(snapToPixel(-1.000000466, 0.018)).toBe(-1);
    expect(snapToPixel(123.456, 0.5)).toBe(123.5);
    expect(snapToPixel(3, 0)).toBe(3);
  });
});

describe('regression: graphs without the new options', () => {
  // The signature formula without the ODE-view field (main before this branch).
  const oldSig = (es: Entry[]) => {
    const F = '\u0001';
    const R = '\u0002';
    return es
      .map(
        (e) =>
          `${e.id}${F}${e.raw}${F}${e.visible ? 1 : 0}${F}${e.t0 ?? ''}${F}${e.ic?.join(',') ?? ''}` +
          `${F}${e.varValue ?? ''}${F}${e.thetaMin ?? ''}${F}${e.thetaMax ?? ''}${F}${e.frames ?? ''}` +
          `${F}${e.samples ?? ''}${F}${e.layer ?? ''}${F}${e.glow ?? ''}${F}${e.blur ?? ''}` +
          `${F}${e.solver ?? ''}${F}${e.steps ?? ''}${F}${e.stepSize ?? ''}${F}${e.conditions ?? ''}${F}${e.bc?.join(',') ?? ''}${F}${R}`,
      )
      .join('');
  };
  const SEED: Entry[] = [
    { id: '1', raw: "y' = y", color: '#c74440', visible: true, expanded: true, t0: 0, ic: [1] },
    { id: '2', raw: "y'' = -y", color: '#2d70b3', visible: true, expanded: false, t0: 0, ic: [0, 1] },
    { id: '3', raw: 't^2+y^2=9', color: '#388c46', visible: true, expanded: false },
    { id: '4', raw: 'y = k*sin(t)', color: '#6042a6', visible: true, expanded: false },
    { id: '5', raw: 'k=3', color: '#fa7e19', visible: true, expanded: false },
    { id: '6', raw: 'y = arctan(t)', color: '#000000', visible: true, expanded: false },
    { id: '9', raw: 'A=(a,b)', color: '#c74440', visible: true, expanded: false },
    { id: '7', raw: 'a=1', color: '#cf2e6b', visible: true, expanded: false },
    { id: '8', raw: 'b=2', color: '#0d9488', visible: true, expanded: false },
  ];
  const SEED_VP: Viewport = { tMin: -6, tMax: 6, yMin: -4, yMax: 4 };

  it('the AGENTIC-TESTS seed: ODE curves are the plain RK4 solution; nothing ghosted or in phase', () => {
    const res = computeAll(SEED, SEED_VP, 1500);
    for (const id of ['1', '2']) {
      const e = SEED.find((x) => x.id === id)!;
      const sys = buildSystem([parseEntry(e.raw) as Extract<Parsed, { kind: 'ode' }>], {});
      const traj = integrateSystem(sys.deriv, { t0: 0, y0: e.ic!, tMin: -6, tMax: 6, samples: 1500 });
      expect(res.get(id)!.curve).toEqual(componentCurve(traj, 0));
      expect(res.get(id)!.ode!.phase).toBeUndefined();
    }
    for (const r of res.values()) expect(r.ghosts).toBeUndefined();
    // Slope fields are opt-in.
    expect(res.get('1')!.ode!.field).toBeUndefined();
    expect(res.get('2')!.ode!.field).toBeUndefined();
    // Non-ODE rows carry no ODE info.
    for (const id of ['3', '4', '5', '6', '9']) expect(res.get(id)!.ode).toBeUndefined();
    expect(computeSignature(SEED)).toBe(oldSig(SEED));
  });

  it.each([...DEMOS, ...EXPRESSION_DEMOS].map((d) => [d.id, d] as const))('demo %s is unchanged', (_id, demo) => {
    const g = demo.build();
    registerAssets(g.assets);
    expect(computeSignature(g.entries)).toBe(oldSig(g.entries));
    const res = computeAll(g.entries, g.viewport, 600);
    for (const r of res.values()) {
      expect(r.ghosts).toBeUndefined();
      expect(r.ode?.phase).toBeUndefined();
      expect(r.ode?.extras).toBeUndefined();
      if (r.parsed.kind !== 'ode') expect(r.ode).toBeUndefined();
    }
  });
});

describe('stateAt', () => {
  it('interpolates the state at a time', () => {
    const traj = [{ ts: [0, 1, 2], ys: [[0, 0], [1, 2], [2, 4]] }];
    expect(stateAt(traj, 1.5)).toEqual([1.5, 3]);
    expect(stateAt(traj, 3)).toBeNull();
  });
});
