/**
 * Script → Graph-mode interop. Built from the Graph-mode entries (plain data:
 * the expression text, initial conditions and slider values), it answers
 * `graph.value("k")`, `graph.fn("f")(2)` and `graph.ode("theta")(t)` using the
 * same parser, scope and RK4 solver as the grapher.
 *
 * ODE solutions are integrated on demand, outwards from t0 on a fixed fine step
 * and kept, so an animation that asks for y(time) frame after frame only ever
 * extends the solution by a step or two. Runs in the sandbox worker and in Node.
 */
import type { MathNode } from 'mathjs';
import { hasSymbol, parseEntry, type Parsed } from '../math/parse';
import { normalizeInput } from '../math/normalize';
import { buildEvalContext } from '../scope';
import { buildSystem } from '../math/reduce';
import { compileNode } from '../math/compileCache';
import { rk4Step, isFiniteVec, maxAbs } from '../solver/rk4';
import type { Entry } from '../../store/types';
import type { GraphEntryData } from './protocol';
import type { GraphBridge } from './runtime';

/** Step of the on-demand integrator (t units). */
export const ODE_STEP = 0.005;
/** Furthest an ODE is integrated from its t0 (|t − t0|). */
export const ODE_MAX_SPAN = 2_000;
const BLOWUP = 1e9;

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

const baseVar = (s: string) => s.replace(/^D\d+_/, '');
const clean = (name: string) => normalizeInput(name.trim()).replace(/\s+/g, '');

/** Lazily integrated solution of one coupled ODE system. */
class DenseSolution {
  private fwd: number[][];
  private bwd: number[][];
  private fwdDead = false;
  private bwdDead = false;
  constructor(
    private deriv: (t: number, y: number[]) => number[],
    readonly t0: number,
    y0: number[],
  ) {
    this.fwd = [y0.slice()];
    this.bwd = [y0.slice()];
  }

  private extend(dir: 1 | -1, steps: number): void {
    const arr = dir > 0 ? this.fwd : this.bwd;
    const h = dir * ODE_STEP;
    while (arr.length - 1 < steps) {
      if (dir > 0 ? this.fwdDead : this.bwdDead) return;
      const i = arr.length - 1;
      const next = rk4Step(this.deriv, this.t0 + i * h, arr[i], h);
      if (!isFiniteVec(next) || maxAbs(next) > BLOWUP) {
        if (dir > 0) this.fwdDead = true;
        else this.bwdDead = true;
        return;
      }
      arr.push(next);
    }
  }

  /** Component `idx` of the state at t (linear interpolation), NaN past a blow-up. */
  at(t: number, idx: number): number {
    if (!Number.isFinite(t)) return NaN;
    const d = t - this.t0;
    if (Math.abs(d) > ODE_MAX_SPAN) return NaN;
    const dir = d >= 0 ? 1 : -1;
    const u = Math.abs(d) / ODE_STEP;
    const i = Math.floor(u);
    this.extend(dir, i + 1);
    const arr = dir > 0 ? this.fwd : this.bwd;
    if (i >= arr.length) return NaN;
    const a = arr[i][idx];
    if (i + 1 >= arr.length) return u === i ? a : NaN;
    return a + (arr[i + 1][idx] - a) * (u - i);
  }
}

export function createGraphBridge(entries: GraphEntryData[]): GraphBridge {
  const parsedList = entries
    .filter((e) => typeof e.raw === 'string' && e.raw.trim())
    .map((e, i) => ({
      entry: { id: `g${i}`, raw: e.raw, color: '', visible: e.visible, expanded: false, t0: e.t0, ic: e.ic, varValue: e.varValue } as Entry,
      parsed: parseEntry(e.raw),
    }));
  const ctx = buildEvalContext(parsedList);
  const scope = ctx.scope as Record<string, unknown>;

  // Named functions of t from `f = sin(t)` style entries.
  const namedT = new Map<string, MathNode>();
  for (const { parsed } of parsedList) {
    if (parsed.kind === 'function' && parsed.name !== 'y' && hasSymbol(parsed.node, 't') && !(parsed.name in scope)) {
      namedT.set(parsed.name, parsed.node);
    }
  }

  const odes = parsedList.filter((p): p is { entry: Entry; parsed: OdeParsed } => p.parsed.kind === 'ode');
  const solutions = new Map<string, { sol: DenseSolution; index: Record<string, number> } | null>();

  function solutionFor(depVar: string) {
    if (solutions.has(depVar)) return solutions.get(depVar)!;
    // The coupled group containing depVar: ODEs connected through their deps.
    const defs = new Map<string, number>();
    odes.forEach((o, i) => {
      if (!defs.has(o.parsed.depVar)) defs.set(o.parsed.depVar, i);
    });
    const start = defs.get(depVar);
    if (start === undefined) {
      solutions.set(depVar, null);
      return null;
    }
    const inGroup = new Set<number>([start]);
    for (let changed = true; changed; ) {
      changed = false;
      odes.forEach((o, i) => {
        if (!defs.has(o.parsed.depVar) || defs.get(o.parsed.depVar) !== i) return;
        const touches =
          inGroup.has(i) ||
          o.parsed.deps.some((d) => {
            const j = defs.get(baseVar(d));
            return j !== undefined && inGroup.has(j);
          }) ||
          [...inGroup].some((j) => odes[j].parsed.deps.some((d) => baseVar(d) === o.parsed.depVar));
        if (touches && !inGroup.has(i)) {
          inGroup.add(i);
          changed = true;
        }
      });
    }
    const members = [...inGroup].sort((a, b) => a - b).map((i) => odes[i]);
    let result: { sol: DenseSolution; index: Record<string, number> } | null = null;
    try {
      const system = buildSystem(
        members.map((m) => m.parsed),
        ctx.scope,
      );
      const y0 = new Array<number>(system.dim).fill(0);
      system.blocks.forEach((block, b) => {
        const ic = members[b].entry.ic;
        for (let k = 0; k < block.order; k++) {
          const v = ic?.[k];
          y0[block.offset + k] = typeof v === 'number' && Number.isFinite(v) ? v : k === 0 ? 1 : 0;
        }
      });
      const t0 = members[0].entry.t0 ?? 0;
      result = { sol: new DenseSolution(system.deriv, Number.isFinite(t0) ? t0 : 0, y0), index: system.index };
    } catch {
      result = null;
    }
    for (const m of members) solutions.set(m.parsed.depVar, result);
    return result;
  }

  const toNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN);

  return {
    value(name) {
      const v = scope[clean(name)];
      return typeof v === 'number' ? v : undefined;
    },
    fn(name) {
      const n = clean(name);
      const f = scope[n];
      if (typeof f === 'function') {
        return (...args: number[]) => {
          try {
            return toNum((f as (...a: number[]) => unknown)(...args));
          } catch {
            return NaN;
          }
        };
      }
      const node = namedT.get(n);
      if (node) {
        const compiled = compileNode(node);
        const local = Object.create(scope) as Record<string, unknown>;
        return (t: number) => {
          local.t = t;
          try {
            return toNum(compiled.evaluate(local));
          } catch {
            return NaN;
          }
        };
      }
      return undefined;
    },
    ode(name, order) {
      const n = clean(name);
      const s = solutionFor(n);
      if (!s) return undefined;
      const k = Math.max(0, Math.floor(order || 0));
      const idx = s.index[k === 0 ? n : `D${k}_${n}`];
      if (idx === undefined) return undefined;
      return (t: number) => s.sol.at(t, idx);
    },
    names() {
      const out = new Set<string>();
      for (const [k, v] of Object.entries(scope)) if (typeof v === 'number') out.add(k);
      for (const n of ctx.fnNames) out.add(n);
      for (const n of namedT.keys()) out.add(n);
      for (const o of odes) out.add(o.parsed.depVar);
      return [...out].filter((n) => !/^(pi|e|tau|phi)$/.test(n));
    },
  };
}
