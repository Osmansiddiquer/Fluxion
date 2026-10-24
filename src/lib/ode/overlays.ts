import { integrateSystem, type Impulse, type SolverMethod, type Trajectory } from '../solver/integrate';
import { forcing } from '../solver/odeGroup';
import { rk4Step } from '../solver/rk4';
import { sampleImplicit } from '../solver/implicit';
import { sampleFunction } from '../solver/sample';
import { sampleSlopeField, sampleVectorField, type FieldSample } from '../solver/field';
import type { Point, SampledCurve } from '../solver/curve';
import { buildSystem, type OdeSystem } from '../math/reduce';
import { compileNode } from '../math/compileCache';
import type { Parsed } from '../math/parse';
import { buildEvalContext, isDerived, type EvalContext } from '../scope';
import { isAutonomous, systemEquilibria, type EquilibriaResult } from '../analysis/equilibria';
import { sliderBounds } from '../anim';
import type { Entry, Viewport } from '../../store/types';
import {
  familyValues,
  phaseRange,
  stateLabel,
  type GroupView,
  type IcTarget,
  type StateOwner,
} from './view';

/**
 * The qualitative layer on top of an integrated ODE group: phase-plane
 * trajectory, slope / vector field, nullclines, equilibria, extra solutions
 * (shift-click) and parameter-family ghosts. Called by computeAll after the
 * group integration; everything expensive is cached here on keys that leave
 * out what it doesn't depend on (the field and equilibria ignore the initial
 * condition, so dragging the IC only re-integrates the one trajectory).
 */

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

/** One coupled ODE group after integration (built by computeAll). */
export interface SolvedGroup {
  /** Member entries / parsed equations in system (block) order. */
  entries: Entry[];
  parsed: OdeParsed[];
  system: OdeSystem;
  traj: Trajectory;
  t0: number;
  y0: number[];
  leaderId: string;
  view: GroupView;
  /** Integrated t-window and step count. */
  range: { tMin: number; tMax: number };
  steps: number;
  /** Members' ids + expressions (no ICs): the system's identity. */
  rawSig: string;
  /** Values of the scope names the equations read (+ user-function key). */
  depSig: string;
  /** Base names the equations read (sliders, derived values). */
  deps: string[];
  callsUser: boolean;
  /** The integrator the group uses (its rows' Numerics choice) and its forcing
   * (impulses, step breakpoints): extra solutions and families use the same. */
  method: SolverMethod;
  forcing: { impulses: Impulse[]; breaks: number[] };
  /** The scope the system was built against (constants for the Jacobian). */
  scope: Record<string, number>;
}

export interface Ghost {
  curve: SampledCurve;
  /** Position in the family's colour ramp, 0…1. */
  u: number;
}

export interface Nullcline {
  segments: Point[][];
  /** Which component vanishes: 0 = horizontal-axis variable's rate, 1 = vertical's. */
  which: 0 | 1;
}

export interface PhaseInfo {
  axes: [number, number];
  /** Axis labels: state names ("x", "y′"). */
  labels: [string, string];
  /** The trajectory in state space (set on the group's leader only). */
  curve?: SampledCurve;
  /** Leader only: the integrated trajectory (state at a time, for the slice marker). */
  traj?: Trajectory;
}

/** Per-entry ODE view data (CurveResult.ode). Group-level parts live on the leader. */
export interface OdeInfo {
  leaderId: string;
  isLeader: boolean;
  groupIds: string[];
  dim: number;
  /** Display names of the state components in system order. */
  stateLabels: string[];
  t0: number;
  y0: number[];
  /** Equations don't read t. */
  autonomous: boolean;
  phase?: PhaseInfo;
  /** Leader only: the drawn field, nullclines, equilibria. */
  field?: FieldSample;
  nullclines?: Nullcline[];
  equilibria?: EquilibriaResult & { mode: 'points' | 'lines' };
  /** Extra solutions: this member's component curves (vs t) or the leader's phase curves. */
  extras?: SampledCurve[];
  /** Where this entry's IC dot sits and what dragging it edits (absent: no dot). */
  ic?: { pos: [number, number]; target: IcTarget };
  /** Shift-click on the plot adds a solution to this group (leader only). */
  canAddSolutions?: boolean;
  /** This component's value at time t, to the solver's accuracy (one RK4 step
   * from the nearest stored state, not a linear read-off); null outside. */
  valueAt?: (t: number) => number | null;
  /** Field eligibility (for the row's switch): 'slope' | 'vector' | undefined. */
  fieldKind?: 'slope' | 'vector';
  fieldOn?: boolean;
}

// ── caches ──────────────────────────────────────────────────────────────────

const OVERLAY_CACHE = new Map<
  string,
  { key: string; field?: FieldSample; nullclines?: Nullcline[]; equilibria?: OdeInfo['equilibria'] }
>();
const TRAJ_CACHE = new Map<string, Trajectory>();
const FAMILY_CACHE = new Map<string, { key: string; curve: SampledCurve }>();
const MAX_TRAJ_CACHE = 400;

/** Test hook: clear every overlay cache. */
export function clearOdeOverlayCaches(): void {
  OVERLAY_CACHE.clear();
  TRAJ_CACHE.clear();
  FAMILY_CACHE.clear();
}

/** Cache sizes (tests assert caching). */
export function odeCacheStats() {
  return { overlays: OVERLAY_CACHE.size, trajectories: TRAJ_CACHE.size, family: FAMILY_CACHE.size };
}

let trajComputes = 0;
/** Number of trajectories integrated by this module (tests count cache misses). */
export function trajectoryComputeCount(): number {
  return trajComputes;
}

function integrateCached(
  key: string,
  system: OdeSystem,
  t0: number,
  y0: number[],
  range: { tMin: number; tMax: number },
  steps: number,
  how: { method: SolverMethod; forcing: { impulses: Impulse[]; breaks: number[] } },
): Trajectory {
  const k = `${key}|${how.method}|${t0}|${y0.join(',')}|${range.tMin},${range.tMax}|${steps}`;
  const hit = TRAJ_CACHE.get(k);
  if (hit) {
    // Refresh recency (Map keeps insertion order).
    TRAJ_CACHE.delete(k);
    TRAJ_CACHE.set(k, hit);
    return hit;
  }
  trajComputes++;
  let traj: Trajectory;
  try {
    traj = integrateSystem(system.deriv, {
      t0,
      y0,
      tMin: range.tMin,
      tMax: range.tMax,
      samples: steps,
      method: how.method,
      impulses: how.forcing.impulses,
      breaks: how.forcing.breaks,
    });
  } catch {
    traj = [];
  }
  TRAJ_CACHE.set(k, traj);
  while (TRAJ_CACHE.size > MAX_TRAJ_CACHE) TRAJ_CACHE.delete(TRAJ_CACHE.keys().next().value!);
  return traj;
}

// ── trajectory projections ──────────────────────────────────────────────────

// Projections are memoised per trajectory, so a cached integration also keeps
// its curves' identity (cheap redraws, stable memo keys downstream).
const PROJ = new WeakMap<Trajectory, Map<string, SampledCurve>>();
function memo(traj: Trajectory, key: string, make: () => SampledCurve): SampledCurve {
  let m = PROJ.get(traj);
  if (!m) PROJ.set(traj, (m = new Map()));
  let c = m.get(key);
  if (!c) m.set(key, (c = make()));
  return c;
}

/** (t, Y[idx]) polylines. */
export function componentCurve(traj: Trajectory, idx: number): SampledCurve {
  return memo(traj, `c${idx}`, () => componentCurveRaw(traj, idx));
}
function componentCurveRaw(traj: Trajectory, idx: number): SampledCurve {
  const segments: Point[][] = [];
  for (const seg of traj) {
    const pts: Point[] = new Array(seg.ts.length);
    for (let i = 0; i < seg.ts.length; i++) pts[i] = [seg.ts[i], seg.ys[i][idx]];
    if (pts.length >= 2) segments.push(pts);
  }
  return { segments };
}

/** (Y[a], Y[b]) polylines: the trajectory in the phase plane. */
export function phaseCurve(traj: Trajectory, a: number, b: number): SampledCurve {
  return memo(traj, `p${a},${b}`, () => phaseCurveRaw(traj, a, b));
}
function phaseCurveRaw(traj: Trajectory, a: number, b: number): SampledCurve {
  const segments: Point[][] = [];
  for (const seg of traj) {
    const pts: Point[] = new Array(seg.ys.length);
    for (let i = 0; i < seg.ys.length; i++) pts[i] = [seg.ys[i][a], seg.ys[i][b]];
    if (pts.length >= 2) segments.push(pts);
  }
  return { segments };
}

/** State at time t along a trajectory (linear between steps), or null outside it. */
export function stateAt(traj: Trajectory, t: number): number[] | null {
  for (const seg of traj) {
    const { ts, ys } = seg;
    if (!ts.length || t < ts[0] || t > ts[ts.length - 1]) continue;
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    const u = ts[hi] === ts[lo] ? 0 : (t - ts[lo]) / (ts[hi] - ts[lo]);
    return ys[lo].map((v, i) => v + u * (ys[hi][i] - v));
  }
  return null;
}

/** The stored step nearest to t (within the trajectory's span), or null. */
export function stateNear(traj: Trajectory, t: number): { t: number; y: number[] } | null {
  for (const seg of traj) {
    const { ts, ys } = seg;
    if (!ts.length || t < ts[0] || t > ts[ts.length - 1]) continue;
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    const i = t - ts[lo] <= ts[hi] - t ? lo : hi;
    return { t: ts[i], y: ys[i] };
  }
  return null;
}

/** Each state component's owner (entry + IC slot), in system order. */
export function stateOwners(g: Pick<SolvedGroup, 'entries' | 'system'>): StateOwner[] {
  const out: StateOwner[] = [];
  g.system.blocks.forEach((b, i) => {
    for (let k = 0; k < b.order; k++) out[b.offset + k] = { entryId: g.entries[i].id, k, order: b.order };
  });
  return out;
}

/** State symbols in system order. */
export function stateSymbols(system: OdeSystem): string[] {
  const out: string[] = [];
  for (const [name, i] of Object.entries(system.index)) out[i] = name;
  return out;
}

// ── field / nullclines / equilibria ─────────────────────────────────────────

/** Map a viewport (horizontal = axes[0], vertical = axes[1]) to the state box (component 0, 1). */
function stateBox(vp: Viewport, axes: [number, number]) {
  const h = { lo: vp.tMin, hi: vp.tMax };
  const v = { lo: vp.yMin, hi: vp.yMax };
  const c0 = axes[0] === 0 ? h : v;
  const c1 = axes[0] === 0 ? v : h;
  return { xMin: c0.lo, xMax: c0.hi, yMin: c1.lo, yMax: c1.hi };
}

/** Planar (horizontal, vertical) rates at a point of the phase plane, at time t. */
function planarRates(system: OdeSystem, axes: [number, number], t: number) {
  const Y = new Array<number>(system.dim).fill(0);
  return (x: number, y: number): [number, number] => {
    Y[axes[0]] = x;
    Y[axes[1]] = y;
    const d = system.deriv(t, Y);
    return [d[axes[0]], d[axes[1]]];
  };
}

function overlaysFor(
  g: SolvedGroup,
  vp: Viewport,
  fieldKind: OdeInfo['fieldKind'],
  fieldOn: boolean,
  autonomous: boolean,
): { field?: FieldSample; nullclines?: Nullcline[]; equilibria?: OdeInfo['equilibria'] } {
  const { system, view } = g;
  const id = g.entries.map((e) => e.id).join('+');
  // The field reads t only through a non-autonomous RHS (drawn at t0 in the phase plane).
  const key =
    `${g.rawSig}|${g.depSig}|${vp.tMin},${vp.tMax},${vp.yMin},${vp.yMax}|${view.key}|` +
    `${fieldKind ?? ''}${fieldOn ? 1 : 0}|${autonomous ? '' : g.t0}`;
  const hit = OVERLAY_CACHE.get(id);
  if (hit && hit.key === key) return hit;
  const out: { key: string; field?: FieldSample; nullclines?: Nullcline[]; equilibria?: OdeInfo['equilibria'] } = {
    key,
  };
  try {
    if (fieldOn && fieldKind === 'slope') {
      const Y = [0];
      out.field = sampleSlopeField((t, y) => {
        Y[0] = y;
        return system.deriv(t, Y)[0];
      }, vp);
    } else if (fieldOn && fieldKind === 'vector') {
      const rates = planarRates(system, view.axes, g.t0);
      out.field = sampleVectorField(rates, vp);
      // Nullclines: where each plotted rate vanishes (marching squares).
      const cellsX = 140;
      const cellsY = Math.max(16, Math.min(260, Math.round(cellsX * ((vp.yMax - vp.yMin) / (vp.tMax - vp.tMin)))));
      out.nullclines = ([0, 1] as const).map((which) => {
        const ev = {
          evaluate: (s: { t: number; y: number }) => rates(s.t, s.y)[which],
        } as unknown as Parameters<typeof sampleImplicit>[0];
        return { which, segments: sampleImplicit(ev, {}, vp, { cellsX, cellsY }).segments };
      });
    }
    // Equilibria: points in the phase plane; against t, lines y = c for a
    // first-order equation only (for y'' = … the stable / centre / saddle
    // type is a phase-plane idea and reads as noise on a y-vs-t plot).
    const scalar = g.entries.length === 1;
    if (system.dim <= 2 && (view.phase || scalar)) {
      const my = 0.1 * (vp.yMax - vp.yMin);
      if (view.phase) {
        const res = systemEquilibria(g.parsed, system, g.scope, stateBox(vp, view.axes));
        out.equilibria = { ...res, mode: 'points' };
      } else if (system.dim === 1) {
        const res = systemEquilibria(g.parsed, system, g.scope, {
          xMin: 0,
          xMax: 1,
          yMin: vp.yMin - my,
          yMax: vp.yMax + my,
        });
        out.equilibria = { ...res, mode: 'lines' };
      }
    }
  } catch {
    /* overlays are best-effort: the curve itself still draws */
  }
  OVERLAY_CACHE.set(id, out);
  return out;
}

// ── per-group info ──────────────────────────────────────────────────────────

/** Group-level field setting: the first member that sets `field` decides. */
function fieldSetting(g: SolvedGroup): boolean | undefined {
  const leader = g.entries.find((e) => e.id === g.leaderId);
  if (leader?.field !== undefined) return leader.field;
  return g.entries.find((e) => e.field !== undefined)?.field;
}

/**
 * Build every ODE entry's view info. Groups are visited in list order so that
 * the automatic vector field goes to the first phase plane only (two fields on
 * one plot would just be noise; `field: true` forces more). Slope fields are
 * off unless `field: true`.
 */
export function buildOdeInfo(
  groups: SolvedGroup[],
  ctx: { entries: Entry[]; viewport: Viewport; samples: number },
): Map<string, OdeInfo> {
  const out = new Map<string, OdeInfo>();
  const order = (g: SolvedGroup) => ctx.entries.findIndex((e) => e.id === g.leaderId);
  const sorted = [...groups].sort((a, b) => order(a) - order(b));
  let autoFieldTaken = false;
  for (const g of sorted) {
    const { system, view, traj } = g;
    const dim = system.dim;
    const visible = g.entries.some((e) => e.visible);
    const autonomous = isAutonomous(g.parsed);
    const labels = stateSymbols(system).map(stateLabel);
    const owners = stateOwners(g);
    const fieldKind: OdeInfo['fieldKind'] =
      view.phase && dim === 2 ? 'vector' : !view.phase && dim === 1 ? 'slope' : undefined;
    const setting = fieldSetting(g);
    let fieldOn = false;
    if (fieldKind && visible) {
      if (setting !== undefined) fieldOn = setting;
      // Slope fields are opt-in (the row's Slope field switch); the phase
      // plane's vector field is part of what the phase switch asks for.
      else if (!autoFieldTaken && fieldKind === 'vector' && autonomous) fieldOn = true;
      if (fieldOn) autoFieldTaken = true;
    }
    const ov = visible ? overlaysFor(g, ctx.viewport, fieldKind, fieldOn, autonomous) : {};

    // Extra solutions.
    const leader = g.entries.find((e) => e.id === g.leaderId)!;
    const sysKey = `${g.rawSig}|${g.depSig}`;
    const extraTrajs: Trajectory[] = [];
    if (visible) {
      for (const ic of leader.extraICs ?? []) {
        if (!Array.isArray(ic) || ic.length !== dim + 1 || !ic.every(Number.isFinite)) continue;
        const [te, ...Ye] = ic;
        const range = view.phase ? phaseRange(te) : g.range;
        extraTrajs.push(integrateCached(sysKey, system, te, Ye, range, g.steps, g));
      }
    }

    const phaseLabels: [string, string] = [labels[view.axes[0]], labels[view.axes[1]]];
    g.system.blocks.forEach((block, bi) => {
      const entry = g.entries[bi];
      const isLeader = entry.id === g.leaderId;
      const info: OdeInfo = {
        leaderId: g.leaderId,
        isLeader,
        groupIds: g.entries.map((e) => e.id),
        dim,
        stateLabels: labels,
        t0: g.t0,
        y0: g.y0,
        autonomous,
        fieldKind,
        fieldOn,
      };
      if (view.phase) {
        info.phase = { axes: view.axes, labels: phaseLabels };
        if (isLeader) {
          info.phase.curve = phaseCurve(traj, view.axes[0], view.axes[1]);
          info.phase.traj = traj;
          if (extraTrajs.length) info.extras = extraTrajs.map((t) => phaseCurve(t, view.axes[0], view.axes[1]));
          info.ic = {
            pos: [g.y0[view.axes[0]], g.y0[view.axes[1]]],
            target: { mode: 'phase', owners: [owners[view.axes[0]], owners[view.axes[1]]] },
          };
        }
      } else {
        if (extraTrajs.length) info.extras = extraTrajs.map((t) => componentCurve(t, block.offset));
        info.ic = {
          pos: [g.t0, g.y0[block.offset]],
          target: { mode: 't', leaderId: g.leaderId, owner: owners[block.offset] },
        };
      }
      info.valueAt = (t: number) => {
        const st = stateNear(traj, t);
        if (!st) return null;
        const Y = st.t === t ? st.y : rk4Step(system.deriv, st.t, st.y, t - st.t);
        const v = Y[block.offset];
        return Number.isFinite(v) ? v : null;
      };
      if (isLeader) {
        if (ov.field) info.field = ov.field;
        if (ov.nullclines) info.nullclines = ov.nullclines;
        if (ov.equilibria) info.equilibria = ov.equilibria;
        info.canAddSolutions = view.phase || g.entries.length === 1;
      }
      out.set(entry.id, info);
    });
  }
  return out;
}

// ── parameter families ──────────────────────────────────────────────────────

interface FamilyCtx {
  parsedList: { entry: Entry; parsed: Parsed }[];
  ectx: EvalContext;
  groups: SolvedGroup[];
  viewport: Viewport;
  samples: number;
  definedKey: string;
  /** Own sample count of an entry (function `samples` override). */
  ownSamples: (e: Entry) => number | undefined;
  /** Entries whose base result is drawable (visible, no error). */
  drawable: (id: string) => boolean;
}

const valueKey = (scope: Record<string, number>, names: string[]) =>
  names.map((d) => (typeof scope[d] === 'number' ? scope[d] : 'u')).join(',');

/**
 * Ghost curves for every slider with `family` on: for FAMILY_N evenly spaced
 * values across its range, the functions and ODE groups that depend on it
 * (directly or through derived values / user functions) are re-sampled with
 * that value. Each (entry, slider, value) is cached on its own, so moving an
 * unrelated slider or the IC of another row doesn't recompute them.
 */
export function familyGhosts(ctx: FamilyCtx): Map<string, Ghost[]> {
  const out = new Map<string, Ghost[]>();
  const live = new Set<string>();
  const { parsedList, ectx, viewport: vp } = ctx;
  for (const { entry: ve, parsed: vp0 } of parsedList) {
    if (!ve.family || vp0.kind !== 'variable') continue;
    const { min, max } = sliderBounds(ve, vp0.value);
    const values = familyValues(min, max);
    const scopes: EvalContext[] = values.map((v) =>
      buildEvalContext(parsedList.map((p) => (p.entry.id === ve.id ? { entry: { ...p.entry, varValue: v }, parsed: p.parsed } : p))),
    );
    const n = values.length;
    const affected = (names: string[], callsUser: boolean) =>
      scopes.some(
        (s) => valueKey(s.scope, names) !== valueKey(ectx.scope, names) || (callsUser && s.fnKey !== ectx.fnKey),
      );
    const push = (id: string, g: Ghost) => {
      const list = out.get(id);
      if (list) list.push(g);
      else out.set(id, [g]);
    };

    // Explicit functions y = f(x).
    for (const { entry, parsed } of parsedList) {
      if (parsed.kind !== 'function' || (isDerived as (p: Parsed) => boolean)(parsed) || !entry.visible || !ctx.drawable(entry.id)) continue;
      const callsUser = ectx.fnNames.size > 0;
      if (!affected(parsed.deps, callsUser)) continue;
      scopes.forEach((s, k) => {
        const slot = `${entry.id}|${ve.id}|${k}`;
        live.add(slot);
        const key =
          `${entry.raw}|${vp.tMin},${vp.tMax},${vp.yMin},${vp.yMax}|${ctx.samples}|${entry.samples ?? ''}|` +
          `${valueKey(s.scope, parsed.deps)}|${callsUser ? s.fnKey : ''}|${ctx.definedKey}`;
        let hit = FAMILY_CACHE.get(slot);
        if (!hit || hit.key !== key) {
          let curve: SampledCurve;
          try {
            curve = sampleFunction(compileNode(parsed.node), s.scope, {
              tMin: vp.tMin,
              tMax: vp.tMax,
              samples: ctx.ownSamples(entry) ?? ctx.samples,
              yMin: vp.yMin,
              yMax: vp.yMax,
            });
          } catch {
            curve = { segments: [] };
          }
          hit = { key, curve };
          FAMILY_CACHE.set(slot, hit);
        }
        push(entry.id, { curve: hit.curve, u: n > 1 ? k / (n - 1) : 0.5 });
      });
    }

    // ODE groups (main initial condition, each value).
    for (const g of ctx.groups) {
      if (!g.entries.some((e) => e.visible && ctx.drawable(e.id))) continue;
      if (!affected(g.deps, g.callsUser)) continue;
      scopes.forEach((s, k) => {
        let traj: Trajectory = [];
        const depSig = `${valueKey(s.scope, g.deps)}|${g.callsUser ? s.fnKey : ''}`;
        try {
          const system = buildSystem(g.parsed, s.scope);
          const members = g.entries.map((entry, i) => ({ entry, parsed: g.parsed[i] }));
          traj = integrateCached(`${g.rawSig}|${depSig}`, system, g.t0, g.y0, g.range, g.steps, {
            method: g.method,
            forcing: forcing(system, members, s.scope),
          });
        } catch {
          traj = [];
        }
        const u = n > 1 ? k / (n - 1) : 0.5;
        g.system.blocks.forEach((block, bi) => {
          const id = g.entries[bi].id;
          if (g.view.phase) {
            if (id === g.leaderId) push(id, { curve: phaseCurve(traj, g.view.axes[0], g.view.axes[1]), u });
          } else push(id, { curve: componentCurve(traj, block.offset), u });
        });
      });
    }
  }
  for (const slot of [...FAMILY_CACHE.keys()]) if (!live.has(slot)) FAMILY_CACHE.delete(slot);
  return out;
}

/** Drop cached overlays for groups whose members are gone. */
export function pruneOdeCaches(liveIds: Set<string>): void {
  for (const id of [...OVERLAY_CACHE.keys()]) if (id.split('+').some((x) => !liveIds.has(x))) OVERLAY_CACHE.delete(id);
}
