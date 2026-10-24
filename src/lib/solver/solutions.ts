import { SymbolNode, type MathNode } from 'mathjs';
import { calledFunctions, type Parsed } from '../math/parse';
import { KNOWN_FUNCTIONS } from '../math/builtins';
import { buildSystem } from '../math/reduce';
import type { Entry } from '../../store/types';
import { integrateSystem, type Impulse, type SolverMethod } from './integrate';
import type { DerivFn } from './rk4';
import { applyOdeNotation, groupStart, odeGroups, resolveGroupSetup, type GroupMember } from './odeGroup';

/**
 * ODE solutions as callable functions: `y(T)`, `y'(T)` (and up to the order's
 * highest derivative) anywhere an expression is evaluated — points, curves,
 * derived values, colour expressions, Script mode's `graph.ode`.
 *
 * A call is answered by a dense solution of the row's coupling group, resolved
 * exactly like the drawn curve (typed conditions, IC sliders / t0, the boundary-
 * value shot, the chosen solver, delta / step forcing). It is integrated on
 * demand outwards from t0 in fixed chunks and kept, so an animation asking for
 * y(T) frame after frame only extends it by a chunk now and then. Solutions are
 * cached by the group's full key (equations, the values they read, conditions,
 * solver), so every scope built for the same graph shares one.
 */

/** Spacing of the stored solution (t units); values between are Hermite-interpolated. */
export const DENSE_STEP = 0.01;
/** Furthest a solution is integrated from its t0 (|t − t0|); NaN beyond. */
export const SOLUTION_MAX_SPAN = 2000;
/** Steps per integration chunk. */
const CHUNK_STEPS = 256;
/** |state| past this ends the solution (as for the drawn curve). */
const BLOWUP = 1e6;
/** Dense solutions kept (LRU, by full key). */
const CACHE_SIZE = 12;

export const SOLUTION_IN_EQUATION = "An ODE's equation can't use a solution value like y(…): use the variable itself";

// Calls made while a group is being integrated are cycles (an equation that
// reads a solution, directly or through a user function): refused.
let solving = 0;
export function whileSolving<T>(f: () => T): T {
  solving++;
  try {
    return f();
  } finally {
    solving--;
  }
}

interface Arm {
  ts: number[];
  ys: number[][];
  dead: boolean;
}

/** A solution integrated on demand in both directions from t0. */
export class DenseOde {
  private fwd: Arm;
  private bwd: Arm;
  private events: number[];
  /** Why integration stopped early (an evaluation error), if it did. */
  error?: string;
  private memo: { arm: Arm | null; i: number; da: number[]; db: number[] } = { arm: null, i: -1, da: [], db: [] };

  constructor(
    private deriv: DerivFn,
    readonly t0: number,
    private y0: number[],
    private opts: { method: SolverMethod; impulses: Impulse[]; breaks: number[]; step: number },
  ) {
    this.fwd = { ts: [], ys: [], dead: false };
    this.bwd = { ts: [t0], ys: [y0.slice()], dead: false };
    this.events = [...opts.impulses.map((p) => p.t), ...opts.breaks];
  }

  /** Integrate one more chunk of an arm. */
  private grow(dir: 1 | -1): void {
    const arm = dir > 0 ? this.fwd : this.bwd;
    if (arm.dead) return;
    const { step, method, impulses, breaks } = this.opts;
    const first = arm.ts.length === 0;
    const ta = first ? this.t0 : arm.ts[arm.ts.length - 1];
    const ya = first ? this.y0 : arm.ys[arm.ys.length - 1];
    let tb = ta + dir * CHUNK_STEPS * step;
    // Keep chunk ends off impulse / break times (a kick at a seam would be lost
    // or doubled going backward).
    for (let guard = 0; guard < 4 && this.events.some((e) => Math.abs(e - tb) < 1e-9 * Math.max(1, Math.abs(tb))); guard++) {
      tb += (dir * step) / 2;
    }
    const len = Math.abs(tb - ta);
    let seg: { ts: number[]; ys: number[][] } | undefined;
    try {
      const traj = whileSolving(() =>
        integrateSystem(this.deriv, {
          t0: ta,
          y0: ya,
          tMin: Math.min(ta, tb),
          tMax: Math.max(ta, tb),
          samples: Math.max(8, Math.round(len / step)),
          method,
          impulses,
          breaks,
          blowup: BLOWUP,
        }),
      );
      seg = traj[0];
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    if (!seg || seg.ts.length < 2) {
      arm.dead = true;
      return;
    }
    let ts = seg.ts;
    let ys = seg.ys;
    if (dir < 0) {
      ts = ts.slice().reverse();
      ys = ys.slice().reverse();
    }
    // ts runs from ta towards tb; its first node is the start state (already stored,
    // except for the very first forward chunk).
    for (let i = first ? 0 : 1; i < ts.length; i++) {
      arm.ts.push(ts[i]);
      arm.ys.push(ys[i]);
    }
    if (Math.abs(ts[ts.length - 1] - tb) > 1e-9 * Math.max(1, Math.abs(tb))) arm.dead = true;
    if (Math.abs(arm.ts[arm.ts.length - 1] - this.t0) >= SOLUTION_MAX_SPAN) arm.dead = true;
  }

  /** The arm and node interval holding t: [i, i+1] (or i alone on an exact node). */
  private locate(t: number): { arm: Arm; i: number; exact: boolean } | null {
    if (!Number.isFinite(t) || Math.abs(t - this.t0) > SOLUTION_MAX_SPAN) return null;
    const dir = t >= this.t0 ? 1 : -1;
    const arm = dir > 0 ? this.fwd : this.bwd;
    const beyond = () => arm.ts.length === 0 || dir * (t - arm.ts[arm.ts.length - 1]) > 0;
    while (beyond() && !arm.dead) this.grow(dir);
    if (beyond()) return null;
    const { ts } = arm;
    // Last node not past t (ascending forward, descending backward).
    let lo = 0;
    let hi = ts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (dir * (ts[mid] - t) <= 0) lo = mid;
      else hi = mid - 1;
    }
    let i = lo;
    if (ts[i] === t) {
      // An impulse repeats a time; the value there is the state just after it
      // (forward: the later node, backward: the earlier one).
      if (dir < 0) while (i > 0 && ts[i - 1] === t) i--;
      return { arm, i, exact: true };
    }
    if (i + 1 >= ts.length) return null;
    return { arm, i, exact: false };
  }

  /** Hermite slopes at both ends of interval i (one-slot memo: animations ask at one t). */
  private slopes(arm: Arm, i: number): { da: number[]; db: number[] } | null {
    const m = this.memo;
    if (m.arm === arm && m.i === i) return m;
    const ta = arm.ts[i];
    const tb = arm.ts[i + 1];
    const eps = 1e-9 * (tb - ta);
    try {
      // Evaluated just inside the interval: a step function's jump sits on a node.
      const da = whileSolving(() => this.deriv(ta + eps, arm.ys[i]));
      const db = whileSolving(() => this.deriv(tb - eps, arm.ys[i + 1]));
      if (!da.every(Number.isFinite) || !db.every(Number.isFinite)) return null;
      this.memo = { arm, i, da, db };
      return this.memo;
    } catch {
      return null;
    }
  }

  /** The full state at t (NaN-filled past a blow-up / out of range). */
  state(t: number): number[] | null {
    const loc = this.locate(t);
    if (!loc) return null;
    const { arm, i } = loc;
    if (loc.exact) return arm.ys[i].slice();
    const ta = arm.ts[i];
    const tb = arm.ts[i + 1];
    const h = tb - ta;
    const s = (t - ta) / h;
    const ya = arm.ys[i];
    const yb = arm.ys[i + 1];
    const sl = this.slopes(arm, i);
    const out = new Array<number>(ya.length);
    if (!sl) {
      for (let k = 0; k < ya.length; k++) out[k] = ya[k] + (yb[k] - ya[k]) * s;
      return out;
    }
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    for (let k = 0; k < ya.length; k++) out[k] = h00 * ya[k] + h10 * h * sl.da[k] + h01 * yb[k] + h11 * h * sl.db[k];
    return out;
  }

  /** Component `idx` of the state at t. */
  at(t: number, idx: number): number {
    const y = this.state(t);
    return y ? y[idx] : NaN;
  }

  /** d/dt of component `idx` at t (the equation's right-hand side for the top one). */
  rate(t: number, idx: number): number {
    const y = this.state(t);
    if (!y) return NaN;
    try {
      const d = whileSolving(() => this.deriv(t, y));
      return d[idx];
    } catch {
      return NaN;
    }
  }
}

const DENSE_CACHE = new Map<string, DenseOde>();

function cachedDense(key: string, make: () => DenseOde): DenseOde {
  const hit = DENSE_CACHE.get(key);
  if (hit) {
    DENSE_CACHE.delete(key);
    DENSE_CACHE.set(key, hit);
    return hit;
  }
  const sol = make();
  DENSE_CACHE.set(key, sol);
  while (DENSE_CACHE.size > CACHE_SIZE) DENSE_CACHE.delete(DENSE_CACHE.keys().next().value!);
  return sol;
}

/** Drop every cached solution (tests). */
export function clearSolutionCache(): void {
  DENSE_CACHE.clear();
}

/** Prefix of the shielded alias of a solution function (see shieldCalls). */
export const SHIELD_PREFIX = 'sol__';

/**
 * `node` with every call of a solution in `names` renamed to its shielded alias,
 * so a sampler that binds the coordinate `y` (implicit curves, regions) still
 * reaches the function `y(…)`. Memoised per node.
 */
const SHIELDED = new WeakMap<MathNode, MathNode>();
export function shieldCalls(node: MathNode, names: Set<string>): MathNode {
  if (!names.size) return node;
  const hit = SHIELDED.get(node);
  if (hit) return hit;
  let any = false;
  const out = node.transform((n, path, parent) => {
    if (
      (n as { type?: string }).type === 'SymbolNode' &&
      path === 'fn' &&
      (parent as { type?: string } | null)?.type === 'FunctionNode' &&
      names.has((n as unknown as { name: string }).name)
    ) {
      any = true;
      return new SymbolNode(SHIELD_PREFIX + (n as unknown as { name: string }).name);
    }
    return n;
  });
  const res = any ? out : node;
  SHIELDED.set(node, res);
  return res;
}

/** A not-yet-computable call (a derived value the equation reads isn't set yet). */
export class NotReady extends Error {}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

/** `D2_y` → `y′′`. */
export function solutionLabel(name: string): string {
  const m = /^D(\d+)_(.+)$/.exec(name);
  return m ? m[2] + '′'.repeat(Number(m[1])) : name;
}

export interface SolutionTable {
  /** Callable solution names: `y`, `D1_y`, … for every ODE dependent variable. */
  names: Set<string>;
  /** Cache-key fragment of the solutions among `calls` ('' when none). */
  keyFor(calls: Iterable<string>): string;
  /** The first error among the solutions in `calls` (undefined when all solve). */
  errorFor(calls: Iterable<string>): string | undefined;
  /** The solution function `name` (y, D1_y, …), if there is one. */
  fn(name: string): ((t: number) => number) | undefined;
}

export const EMPTY_SOLUTIONS: SolutionTable = {
  names: new Set(),
  keyFor: () => '',
  errorFor: () => undefined,
  fn: () => undefined,
};

interface GroupState {
  members: GroupMember[];
  deps: string[];
  callsUser: boolean;
  /** Set once resolved (for this scope). */
  done?: { key: string; sol?: DenseOde; index: Record<string, number>; error?: string };
}

export interface SolutionOpts {
  varNames: Set<string>;
  derivedNames: Set<string>;
  fnNames: Set<string>;
  /** Every user function definition (their bodies' reads join the key). */
  fnDefs: { raw: string; deps: string[] }[];
  /** Step of the fixed-step methods (the drawn curve's step: Euler's error depends on it). */
  fixedStep?: number;
}

/**
 * Put a solution function for every ODE dependent variable into `scope` (not
 * for names already defined as sliders, derived values or user functions —
 * those win) and return the table compute uses for validation and cache keys.
 * Nothing is integrated until a solution is first called.
 */
export function installSolutions(
  items: { entry: Entry; parsed: Parsed }[],
  scope: Record<string, unknown>,
  opts: SolutionOpts,
): SolutionTable {
  if (!items.some((i) => i.parsed.kind === 'ode')) return EMPTY_SOLUTIONS;
  const { varNames, derivedNames, fnNames } = opts;
  // ODE notation on copies (compute applies it to its own list later).
  const list = items.map((i) => ({ entry: i.entry, parsed: i.parsed }));
  const depVars = new Set<string>();
  for (const { parsed } of list) if (parsed.kind === 'ode') depVars.add(parsed.depVar);
  const condRows = applyOdeNotation(list, depVars, new Set([...varNames, ...derivedNames]));
  const odes = list.filter((p): p is { entry: Entry; parsed: OdeParsed } => p.parsed.kind === 'ode');
  const entries = items.map((i) => i.entry);
  // Sliders, derived values and user functions win; so do built-ins (an ODE in
  // u keeps u(t − 1) meaning the unit step).
  const taken = (n: string) => varNames.has(n) || derivedNames.has(n) || fnNames.has(n) || KNOWN_FUNCTIONS.has(n);

  const names = new Set<string>();
  const owner = new Map<string, { g: GroupState; depVar: string; k: number; order: number }>();
  const seen = new Set<string>();
  for (const idxs of odeGroups(odes.map((o) => o.parsed))) {
    const members = idxs.map((i) => odes[i]);
    const deps = new Set<string>();
    for (const m of members) {
      for (const d of m.parsed.deps) deps.add(d.replace(/^D\d+_/, ''));
      for (const c of [...(m.parsed.conds ?? []), ...(condRows.get(m.parsed.depVar) ?? [])]) {
        for (const n of [c.at, c.value]) n.traverse((x) => {
          if ((x as { type?: string }).type === 'SymbolNode') deps.add((x as unknown as { name: string }).name);
        });
      }
    }
    const callsUser = members.some((m) =>
      [m.parsed.node, ...(m.parsed.impulses ?? []).flatMap((p) => [p.arg, p.coef])].some((n) =>
        [...calledFunctions(n)].some((f) => fnNames.has(f)),
      ),
    );
    const g: GroupState = { members, deps: [...deps], callsUser };
    for (const m of members) {
      const { depVar, order } = m.parsed;
      if (seen.has(depVar)) continue;
      seen.add(depVar);
      if (taken(depVar)) continue;
      for (let k = 0; k <= order; k++) {
        const name = k === 0 ? depVar : `D${k}_${depVar}`;
        if (taken(name)) continue;
        names.add(name);
        owner.set(name, { g, depVar, k, order });
      }
    }
  }
  if (!names.size) return EMPTY_SOLUTIONS;

  const num = (d: string) => (typeof scope[d] === 'number' ? scope[d] : 'u');
  const resolve = (g: GroupState): NonNullable<GroupState['done']> => {
    if (g.done) return g.done;
    if (solving) throw new Error(SOLUTION_IN_EQUATION);
    const depVar = g.members[0].parsed.depVar;
    // Wait for derived values the equations (or the functions they call) read.
    const reads = g.callsUser ? [...g.deps, ...opts.fnDefs.flatMap((f) => f.deps)] : g.deps;
    for (const d of reads) {
      if (derivedNames.has(d) && !(d in scope)) {
        throw new NotReady(`Circular definition: the equation for ${depVar} uses ${d}`);
      }
    }
    const finish = (done: NonNullable<GroupState['done']>) => (g.done = done);
    const bad = (error: string) => finish({ key: `!${error}`, index: {}, error });
    // An equation reading a solution is a cycle (or at best order-dependent): refused.
    for (const m of g.members) {
      const calls = [m.parsed.node, ...(m.parsed.impulses ?? []).flatMap((p) => [p.arg, p.coef])].flatMap((n) => [
        ...calledFunctions(n),
      ]);
      if (calls.some((f) => names.has(f))) return bad(SOLUTION_IN_EQUATION);
      const unknown = calls.filter((f) => !KNOWN_FUNCTIONS.has(f) && !fnNames.has(f));
      if (unknown.length) return bad(`Unknown function: ${unknown.join(', ')}`);
    }
    const setup = resolveGroupSetup(g.members, condRows, scope, entries, fnNames, names);
    if (setup.error) return bad(setup.error);
    const fixed = setup.method === 'euler' && opts.fixedStep && Number.isFinite(opts.fixedStep) ? opts.fixedStep : DENSE_STEP;
    const step = Math.min(0.05, Math.max(1e-4, fixed));
    const memberSig = g.members
      .map((m) => `${m.entry.raw}:${m.entry.t0 ?? ''}:${m.entry.ic?.join('_') ?? ''}:${m.parsed.indep ?? ''}`)
      .join(';');
    const condSig = g.members.map((m) => (condRows.get(m.parsed.depVar) ?? []).map((c) => c.text).join(',')).join(';');
    const fnSig = g.callsUser ? opts.fnDefs.map((f) => `${f.raw}:${f.deps.map(num).join(',')}`).join(';') : '';
    const key = `${memberSig}|${condSig}|${g.deps.map(num).join(',')}|${fnSig}|${setup.key}|${step}`;
    try {
      const system = buildSystem(
        g.members.map((m) => m.parsed),
        scope as Record<string, number>,
      );
      const sol = cachedDense(key, () => {
        const start = whileSolving(() => groupStart(system, g.members, setup, scope));
        return new DenseOde(system.deriv, start.t0, start.y0, {
          method: setup.method,
          impulses: start.impulses,
          breaks: start.breaks,
          step,
        });
      });
      return finish({ key, sol, index: system.index });
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
  };

  const fns = new Map<string, (t: number) => number>();
  for (const [name, o] of owner) {
    const label = solutionLabel(name);
    const top = o.k === o.order;
    const f = (...args: unknown[]): number => {
      if (solving) throw new Error(SOLUTION_IN_EQUATION);
      if (args.length !== 1) throw new Error(`${label} takes one argument: ${label}(t)`);
      const t = args[0];
      if (typeof t !== 'number') throw new Error(`${label}(…) needs a number`);
      const done = resolve(o.g);
      if (done.error || !done.sol) throw new Error(`${label}(…): ${done.error ?? 'no solution'}`);
      const idx = done.index[top ? (o.k === 1 ? o.depVar : `D${o.k - 1}_${o.depVar}`) : name];
      const v = top ? done.sol.rate(t, idx) : done.sol.at(t, idx);
      if (Number.isNaN(v) && done.sol.error) throw new Error(`${label}(…): ${done.sol.error}`);
      return v;
    };
    scope[name] = f;
    // Under a second name too, for expressions where the plain name is also a
    // coordinate (`y < y(x)`: the region test sets y to a number).
    scope[SHIELD_PREFIX + name] = f;
    fns.set(name, f as (t: number) => number);
  }

  const groupsOf = (calls: Iterable<string>) => {
    const out = new Set<GroupState>();
    for (const c of calls) {
      const o = owner.get(c);
      if (o) out.add(o.g);
    }
    return out;
  };
  const safeResolve = (g: GroupState) => {
    try {
      return resolve(g);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { key: `!${error}`, index: {}, error };
    }
  };

  return {
    names,
    keyFor(calls) {
      let k = '';
      for (const g of groupsOf(calls)) k += `[${safeResolve(g).key}]`;
      return k;
    },
    errorFor(calls) {
      for (const c of calls) {
        const o = owner.get(c);
        if (!o) continue;
        const done = safeResolve(o.g);
        if (done.error) return `${solutionLabel(c)}(…): ${done.error}`;
      }
      return undefined;
    },
    fn: (name) => fns.get(name),
  };
}
