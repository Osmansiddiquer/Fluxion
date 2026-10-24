/**
 * Script → Graph-mode interop. Built from the Graph-mode entries (plain data:
 * the expression text, initial conditions, ODE options and slider values), it
 * answers `graph.value("k")`, `graph.fn("f")(2)` and `graph.ode("theta")(t)`
 * using the same parser and scope as the grapher.
 *
 * ODE solutions are the grapher's own `y(T)` solutions (lib/solver/solutions):
 * typed conditions, boundary values, the chosen solver and delta / step forcing
 * all apply, integrated on demand outwards from t0 and kept, so an animation
 * that asks for y(time) frame after frame only extends the solution now and
 * then. Runs in the sandbox worker and in Node.
 */
import type { MathNode } from 'mathjs';
import { hasSymbol, parseEntry } from '../math/parse';
import { normalizeInput } from '../math/normalize';
import { buildEvalContext } from '../scope';
import { compileNode } from '../math/compileCache';
import { SOLVER_METHODS } from '../solver/integrate';
import { SOLUTION_MAX_SPAN } from '../solver/solutions';
import type { Entry } from '../../store/types';
import type { GraphEntryData } from './protocol';
import type { GraphBridge } from './runtime';

/** Furthest an ODE is integrated from its t0 (|t − t0|). */
export const ODE_MAX_SPAN = SOLUTION_MAX_SPAN;

const clean = (name: string) => normalizeInput(name.trim()).replace(/\s+/g, '');

/** The entry fields a solve reads, checked (the data crosses a worker boundary). */
function toEntry(e: GraphEntryData, i: number): Entry {
  const nums = (v: unknown, n?: number) =>
    Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x)) && (n === undefined || v.length === n)
      ? (v as number[])
      : undefined;
  const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const entry: Entry = { id: `g${i}`, raw: e.raw, color: '', visible: e.visible !== false, expanded: false };
  const t0 = fin(e.t0);
  if (t0 !== undefined) entry.t0 = t0;
  const ic = nums(e.ic);
  if (ic) entry.ic = ic;
  const v = fin(e.varValue);
  if (v !== undefined) entry.varValue = v;
  if (typeof e.solver === 'string' && (SOLVER_METHODS as readonly string[]).includes(e.solver)) {
    entry.solver = e.solver as NonNullable<Entry['solver']>;
  }
  if (e.conditions === 'boundary' || e.conditions === 'initial') entry.conditions = e.conditions;
  const bc = nums(e.bc, 4);
  if (bc) entry.bc = bc;
  return entry;
}

export function createGraphBridge(entries: GraphEntryData[]): GraphBridge {
  const parsedList = entries
    .filter((e) => typeof e.raw === 'string' && e.raw.trim())
    .map((e, i) => ({ entry: toEntry(e, i), parsed: parseEntry(e.raw) }));
  const ctx = buildEvalContext(parsedList);
  const scope = ctx.scope as Record<string, unknown>;

  // Named functions of t from `f = sin(t)` style entries.
  const namedT = new Map<string, MathNode>();
  for (const { parsed } of parsedList) {
    if (parsed.kind === 'function' && parsed.name !== 'y' && hasSymbol(parsed.node, 't') && !(parsed.name in scope)) {
      namedT.set(parsed.name, parsed.node);
    }
  }
  const odeVars = new Set<string>();
  for (const { parsed } of parsedList) if (parsed.kind === 'ode') odeVars.add(parsed.depVar);

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
      if (!odeVars.has(n)) return undefined;
      const k = Math.max(0, Math.floor(order || 0));
      const f = ctx.solutions.fn(k === 0 ? n : `D${k}_${n}`);
      if (!f) return undefined;
      return (t: number) => {
        try {
          return toNum(f(t));
        } catch {
          return NaN;
        }
      };
    },
    names() {
      const out = new Set<string>();
      for (const [k, v] of Object.entries(scope)) if (typeof v === 'number') out.add(k);
      for (const n of ctx.fnNames) out.add(n);
      for (const n of namedT.keys()) out.add(n);
      for (const n of odeVars) out.add(n);
      return [...out].filter((n) => !/^(pi|e|tau|phi)$/.test(n));
    },
  };
}
