import type { CondSpec, Parsed } from '../math/parse';
import { calledFunctions } from '../math/parse';
import { compileNode } from '../math/compileCache';
import { KNOWN_FUNCTIONS } from '../math/builtins';
import type { OdeSystem } from '../math/reduce';
import type { Entry } from '../../store/types';
import { integrateSystem, DEFAULT_SOLVER, type Impulse, type SolverMethod, type Trajectory } from './integrate';
import { newInfo, type IntegrateInfo } from './adaptive';
import { runSteps, globalErrors, DEFAULT_STEP_SIZE, MIN_STEP_SIZE, MAX_STEP_SIZE, type StepMethod } from './methods';
import { shoot } from './shooting';

/**
 * Everything about *how* a coupled ODE group is solved, beyond the equations:
 * typed conditions (`y(0) = 2`, boundary rows), the boundary-value mode, the
 * integrator choice, impulses / step breakpoints and the "Show steps" teaching
 * run. compute.ts resolves a setup (cheap, part of the group cache key) and only
 * runs the group when that key changes.
 */

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;
export interface GroupMember {
  entry: Entry;
  parsed: OdeParsed;
}

/** Per-entry facts about its ODE solve (shown in IVPControls / the Numerics panel / trace). */
export interface OdeNumerics {
  /** The initial point actually used (after typed conditions and shooting). */
  t0: number;
  /** This entry's initial state [y, y′, …] at t0. */
  ic: number[];
  /** Which of t0 / ic came from typed conditions. */
  typedT0: boolean;
  typedIc: boolean[];
  /** The typed conditions, as text (`y(0) = 1`). */
  typedText: string[];
  /** Solved as a boundary-value problem: y(a) = α, y(b) = β (component ia / ib). */
  bvp?: { a: number; alpha: number; b: number; beta: number; ia: number; ib: number; typed: boolean };
  /** Effective integrator and its counters. */
  solver: SolverMethod;
  stats: IntegrateInfo;
  /** Impulse times (delta forcing) of this entry. */
  impulses: number[];
  /** The "Show steps" run: step times, this entry's values, global errors. */
  steps?: { method: StepMethod; h: number; ts: number[]; ys: number[]; err: number[]; truncated: boolean };
}

interface MemberSetup {
  ic: number[];
  typedIc: boolean[];
  typedT0?: number;
  typedText: string[];
}

export interface GroupSetup {
  /** Error for the whole group (bad conditions). */
  error?: string;
  t0: number;
  typedT0: boolean;
  members: MemberSetup[];
  bvp?: { a: number; alpha: number; b: number; beta: number; ia: 0 | 1; ib: 0 | 1; typed: boolean };
  method: SolverMethod;
  /** Cache-key fragment: every resolved number above + numerics options. */
  key: string;
}

export const DEFAULT_BC: readonly number[] = [0, 0, 1, 1];

const X_READING = new WeakMap<OdeParsed, OdeParsed>();

/**
 * Graph-level ODE notation, applied to the parsed rows in place:
 *  - `y' = x·y` (prime notation, x but no t) takes x as the independent variable
 *    unless an ODE (`x' = …`) or a slider defines x;
 * and returns the conditions typed on their own (visible) rows, by variable.
 */
export function applyOdeNotation(
  list: { entry: Entry; parsed: Parsed }[],
  depVars: Set<string>,
  valueNames: Set<string>,
): Map<string, CondSpec[]> {
  const xDefined = depVars.has('x') || valueNames.has('x');
  const condRows = new Map<string, CondSpec[]>();
  for (const item of list) {
    const p = item.parsed;
    if (p.kind === 'ode' && p.xAlt && !xDefined) {
      let alt = X_READING.get(p);
      if (!alt) {
        alt = { ...p.xAlt, raw: p.raw, ...(p.conds ? { conds: p.conds } : {}) };
        X_READING.set(p, alt);
      }
      item.parsed = alt;
    } else if (p.kind === 'condition' && item.entry.visible) {
      const list2 = condRows.get(p.depVar) ?? [];
      list2.push(...p.conds);
      condRows.set(p.depVar, list2);
    }
  }
  return condRows;
}

export function stepSizeOf(entry: Entry): number {
  const h = entry.stepSize;
  if (typeof h !== 'number' || !Number.isFinite(h)) return DEFAULT_STEP_SIZE;
  return Math.min(MAX_STEP_SIZE, Math.max(MIN_STEP_SIZE, h));
}

function resolveIC(ic: number[] | undefined, order: number): number[] {
  const out = new Array<number>(order).fill(0);
  out[0] = 1;
  if (ic) for (let i = 0; i < order; i++) if (i < ic.length && Number.isFinite(ic[i])) out[i] = ic[i];
  return out;
}

const callsOk = (c: CondSpec, fnNames: Set<string>) =>
  [c.at, c.value].every((n) => [...calledFunctions(n)].every((f) => KNOWN_FUNCTIONS.has(f) || fnNames.has(f)));
const callsSolution = (c: CondSpec, solNames: Set<string>) =>
  solNames.size > 0 && [c.at, c.value].some((n) => [...calledFunctions(n)].some((f) => solNames.has(f)));

/** A condition's number, or NaN while it names something undefined (mid-typing). */
function evalNum(node: CondSpec['at'], scope: Record<string, unknown>): number {
  try {
    const v = compileNode(node).evaluate(scope);
    return typeof v === 'number' ? v : NaN;
  } catch {
    return NaN;
  }
}

const prime = (name: string, k: number) => name + '′'.repeat(k);

/**
 * Resolve the conditions and options of a group. `condRows` maps a dependent
 * variable to the conditions typed on their own rows. `entries` gives row order
 * (the earliest member's t0 is the group's, as before).
 */
export function resolveGroupSetup(
  members: GroupMember[],
  condRows: Map<string, CondSpec[]>,
  scope: Record<string, unknown>,
  entries: Entry[],
  fnNames: Set<string> = new Set(),
  solNames: Set<string> = new Set(),
): GroupSetup {
  const first = members.reduce((a, m) => (entries.indexOf(m.entry) < entries.indexOf(a.entry) ? m : a), members[0]);
  const method: SolverMethod = first.entry.solver ?? DEFAULT_SOLVER;
  let error: string | undefined;
  let t0 = first.entry.t0 ?? 0;
  let typedT0 = false;
  let bvp: GroupSetup['bvp'];
  const setups: MemberSetup[] = members.map((m) => ({
    ic: resolveIC(m.entry.ic, m.parsed.order),
    typedIc: new Array<boolean>(m.parsed.order).fill(false),
    typedText: [],
  }));
  const typedPoints: number[] = [];

  members.forEach((m, mi) => {
    const { depVar, order } = m.parsed;
    const conds = [...(m.parsed.conds ?? []), ...(condRows.get(depVar) ?? [])];
    if (!conds.length) return;
    const su = setups[mi];
    su.typedText = conds.map((c) => c.text.replace(/D(\d+)_([A-Za-z]\w*)/g, (_s, k, n) => prime(n, Number(k))));
    const vals: { k: number; at: number; v: number; text: string }[] = [];
    for (const c of conds) {
      if (callsSolution(c, solNames)) {
        error ??= "A condition can't use a solution value: give it a number (or a slider)";
        return;
      }
      if (!callsOk(c, fnNames)) {
        error ??= 'Unknown function in a condition';
        return;
      }
      const at = evalNum(c.at, scope);
      const v = evalNum(c.value, scope);
      if (!Number.isFinite(at) || !Number.isFinite(v)) {
        error ??= `${prime(depVar, c.k)}(…) needs numbers (define its sliders)`;
        return;
      }
      if (c.k >= order) {
        error ??= `${depVar} is ${order === 1 ? '1st' : order === 2 ? '2nd' : `${order}th`} order: conditions go up to ${prime(depVar, order - 1)}`;
        return;
      }
      if (vals.some((o) => o.k === c.k && Math.abs(o.at - at) < 1e-12)) {
        error ??= `${prime(depVar, c.k)}(${fmt(at)}) is given twice`;
        return;
      }
      vals.push({ k: c.k, at, v, text: c.text });
    }
    if (vals.length > order) {
      error ??= `${prime(depVar, order)} = … takes ${order} condition${order > 1 ? 's' : ''}, not ${vals.length}`;
      return;
    }
    const points = [...new Set(vals.map((o) => o.at))];
    if (points.length === 1) {
      // Initial values at one point (missing components keep the slider values).
      typedPoints.push(points[0]);
      su.typedT0 = points[0];
      for (const o of vals) {
        su.ic[o.k] = o.v;
        su.typedIc[o.k] = true;
      }
    } else if (points.length === 2 && order === 2 && members.length === 1) {
      const [ca, cb] = [vals[0], vals.find((o) => o.at !== vals[0].at)!];
      if (vals.length !== 2) {
        error ??= 'A boundary-value problem takes one condition at each end';
        return;
      }
      bvp = { a: ca.at, alpha: ca.v, b: cb.at, beta: cb.v, ia: ca.k as 0 | 1, ib: cb.k as 0 | 1, typed: true };
    } else {
      error ??=
        order === 2 && members.length === 1
          ? 'Give the conditions at one t (initial values) or one at each end (a boundary problem)'
          : 'Give the conditions at one t (initial values)';
    }
  });

  if (typedPoints.length) {
    if (typedPoints.some((p) => Math.abs(p - typedPoints[0]) > 1e-12)) {
      error ??= 'Initial conditions for a system must all be at the same t';
    }
    t0 = typedPoints[0];
    typedT0 = true;
  }

  // Boundary mode from the Conditions switch (typed conditions win).
  const m0 = members[0];
  if (!bvp && !typedT0 && m0.entry.conditions === 'boundary' && m0.parsed.order === 2 && members.length === 1) {
    const bc = m0.entry.bc && m0.entry.bc.length === 4 && m0.entry.bc.every(Number.isFinite) ? m0.entry.bc : DEFAULT_BC;
    bvp = { a: bc[0], alpha: bc[1], b: bc[2], beta: bc[3], ia: 0, ib: 0, typed: false };
  } else if (!bvp && m0.entry.conditions === 'boundary' && members.length > 1 && m0.parsed.order === 2) {
    error ??= 'Boundary conditions need a single 2nd-order equation (not a coupled system)';
  }
  if (bvp) t0 = bvp.a;

  const stepsKey = members.map((m) => (m.entry.steps ? `${m.entry.steps}@${stepSizeOf(m.entry)}` : '')).join(',');
  const key =
    `${t0}|${typedT0 ? 1 : 0}|${setups.map((s) => s.ic.join('_') + ':' + s.typedIc.map(Number).join('')).join(';')}|` +
    `${bvp ? `${bvp.a},${bvp.alpha},${bvp.b},${bvp.beta},${bvp.ia},${bvp.ib}` : ''}|${method}|${stepsKey}|${error ?? ''}`;
  return { error, t0, typedT0, members: setups, bvp, method, key };
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toPrecision(4);
}

/** Impulses and step-function breakpoints of the group, evaluated against the scope. */
/** Impulses and right-hand-side breaks of a group (also used for extra solutions / families). */
export function forcing(
  system: OdeSystem,
  members: GroupMember[],
  scope: Record<string, unknown>,
): { impulses: Impulse[]; breaks: number[]; perMember: number[][] } {
  const impulses: Impulse[] = [];
  const breaks: number[] = [];
  const stateNames = Object.keys(system.index);
  const at0 = { ...scope, t: 0 };
  const perMember = members.map(() => [] as number[]);
  members.forEach((m, b) => {
    const block = system.blocks[b];
    for (const imp of m.parsed.impulses ?? []) {
      const k = evalNum(imp.slope, at0);
      const c0 = evalNum(imp.arg, at0);
      const a = -c0 / k;
      if (!Number.isFinite(a) || !(Math.abs(k) > 0)) continue;
      const coef = compileNode(imp.coef, stateNames);
      const evalScope: Record<string, unknown> = { ...scope };
      impulses.push({
        t: a,
        index: block.offset + block.order - 1,
        amount: (Y) => {
          evalScope.t = a;
          for (const name of stateNames) evalScope[name] = Y[system.index[name]];
          const v = coef.evaluate(evalScope);
          return typeof v === 'number' ? v / Math.abs(k) : NaN;
        },
      });
      perMember[b].push(a);
    }
    for (const arg of m.parsed.breaks ?? []) {
      // arg(t) is linear: root = −arg(0) / arg′.
      const v0 = evalNum(arg, at0);
      const v1 = evalNum(arg, { ...scope, t: 1 });
      const slope = v1 - v0;
      const r = -v0 / slope;
      if (Number.isFinite(r) && slope !== 0) breaks.push(r);
    }
  });
  return { impulses, breaks, perMember };
}

export interface GroupRun {
  traj: Trajectory;
  numerics: OdeNumerics[];
}

/**
 * The initial point a group is integrated from (typed conditions applied, a
 * boundary-value problem shot) and its forcing. Shared by the drawn curve
 * (runGroup) and the on-demand solution `y(T)` (lib/solver/solutions), so both
 * follow the same trajectory. Throws on a bad setup or a failed shot.
 */
export function groupStart(
  system: OdeSystem,
  members: GroupMember[],
  setup: GroupSetup,
  scope: Record<string, unknown>,
): { t0: number; y0: number[]; impulses: Impulse[]; breaks: number[]; perMember: number[][] } {
  if (setup.error) throw new Error(setup.error);
  const { impulses, breaks, perMember } = forcing(system, members, scope);
  const y0 = new Array<number>(system.dim).fill(0);
  system.blocks.forEach((block, b) => {
    for (let k = 0; k < block.order; k++) y0[block.offset + k] = setup.members[b].ic[k];
  });
  let t0 = setup.t0;
  if (setup.bvp) {
    const p = setup.bvp;
    const res = shoot({ deriv: system.deriv, a: p.a, b: p.b, ia: p.ia, alpha: p.alpha, ib: p.ib, beta: p.beta, impulses, breaks });
    if (!res.ok) throw new Error(res.error);
    y0[0] = res.y0[0];
    y0[1] = res.y0[1];
    t0 = p.a;
  }
  return { t0, y0, impulses, breaks, perMember };
}

/**
 * Coupling groups of ODE rows: rows are joined when one's equation reads
 * another's dependent variable (the first row defining a variable owns it).
 * Returns groups of indices into `odes`, in first-appearance order.
 */
export function odeGroups(odes: { depVar: string; deps: string[] }[]): number[][] {
  const defByVar = new Map<string, number>();
  odes.forEach((o, i) => {
    if (!defByVar.has(o.depVar)) defByVar.set(o.depVar, i);
  });
  const parent = odes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  odes.forEach((o, i) => {
    for (const dep of o.deps) {
      const j = defByVar.get(dep.replace(/^D\d+_/, ''));
      if (j === undefined || j === i) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[ra] = rb;
    }
  });
  const groups = new Map<number, number[]>();
  odes.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()];
}

/** Integrate a group with its resolved setup. Throws (message → each member's error). */
export function runGroup(
  system: OdeSystem,
  members: GroupMember[],
  setup: GroupSetup,
  scope: Record<string, unknown>,
  view: { tMin: number; tMax: number; samples: number },
): GroupRun {
  const { t0, y0, impulses, breaks, perMember } = groupStart(system, members, setup, scope);
  const info = newInfo();
  const traj = integrateSystem(system.deriv, {
    t0,
    y0,
    tMin: view.tMin,
    tMax: view.tMax,
    samples: view.samples,
    method: setup.method,
    impulses,
    breaks,
    info,
  });
  const numerics = members.map((m, b): OdeNumerics => {
    const block = system.blocks[b];
    const su = setup.members[b];
    const out: OdeNumerics = {
      t0,
      ic: y0.slice(block.offset, block.offset + block.order),
      typedT0: setup.typedT0,
      typedIc: su.typedIc,
      typedText: su.typedText,
      solver: setup.method,
      stats: info,
      impulses: perMember[b],
    };
    if (setup.bvp) out.bvp = { ...setup.bvp };
    const method = m.entry.steps;
    if (method) {
      const h = stepSizeOf(m.entry);
      const run = runSteps(system.deriv, method, t0, y0, h, view.tMin, view.tMax, { impulses });
      const err = globalErrors(system.deriv, run, t0, y0, block.offset, { impulses, breaks });
      out.steps = {
        method,
        h,
        ts: run.ts,
        ys: run.ys.map((y) => y[block.offset]),
        err,
        truncated: run.truncated,
      };
    }
    return out;
  });
  return { traj, numerics };
}
