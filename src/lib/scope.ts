import { calledFunctions, hasSymbol, type Parsed } from './math/parse';
import { KNOWN_FUNCTIONS } from './math/builtins';
import { compileNode } from './math/compileCache';
import { HELPERS } from './math/helpers';
import type { Entry } from '../store/types';
import { installSolutions, type SolutionTable } from './solver/solutions';
import { coordSymbol, prettyCoords } from './math/coords';

/**
 * The evaluation scope shared by every expression: scripting helpers, slider
 * variables, derived values (`b = 2a`), and user functions (`f(u) = …`).
 *
 * mathjs looks a called name up in the scope before its own namespace, so user
 * functions and helpers live here as plain JS closures. A user function sees its
 * parameters plus the global scope (prototype chain), never the caller's locals
 * (t, y, loop variables) — functions are pure in their arguments + globals.
 */
export interface EvalContext {
  /** Typed as numbers for the samplers; also holds helper / user functions. */
  scope: Record<string, number>;
  varNames: Set<string>;
  derivedNames: Set<string>;
  fnNames: Set<string>;
  /** Derived-value results / errors by entry id. */
  derivedValues: Map<string, number>;
  derivedErrors: Map<string, string>;
  /** Changes whenever any user function's definition or captured values change
   * (including the ODE solutions their bodies call). */
  fnKey: string;
  /** ODE solutions callable as `y(T)`, `y'(T)` (lib/solver/solutions). */
  solutions: SolutionTable;
  /** Named points `A = (…, …)` (first definition of each name). Their
   * coordinates are the scope symbols `A__x` / `A__y` (A.x / A.y, lib/math/coords). */
  pointNames: Set<string>;
  /** Resolved coordinates of each named point with finite coordinates. */
  points: Map<string, [number, number]>;
  /** Why a named point has no coordinates (cycle, bad call, …), by entry id. */
  pointErrors: Map<string, string>;
}

export interface EvalOpts {
  /** Step of fixed-step ODE solutions (compute passes the drawn curve's). */
  odeStep?: number;
}

type FnDef = Extract<Parsed, { kind: 'fndef' }>;
type FnParsed = Extract<Parsed, { kind: 'function' }>;
type PointParsed = Extract<Parsed, { kind: 'pointvar' }>;

/** A named expression of no t (`b = 2a + 1`) is a derived value, not a curve. */
export function isDerived(parsed: Parsed): parsed is FnParsed {
  return parsed.kind === 'function' && parsed.name !== 'y' && !hasSymbol(parsed.node, 't');
}

/** A one-parameter function of x or t (`f(x) = x²`) is also plotted, Desmos-style. */
export function isPlottableFnDef(parsed: Parsed): parsed is FnDef {
  return parsed.kind === 'fndef' && parsed.params.length === 1 && (parsed.params[0] === 'x' || parsed.params[0] === 't');
}

const MAX_DEPTH = 64;

function makeUserFn(def: FnDef, global: Record<string, unknown>, depth: { n: number }) {
  const compiled = compileNode(def.node, def.params);
  const local = Object.create(global) as Record<string, unknown>;
  const { params, name } = def;
  // Last-call memo. A user function is pure in (arguments, globals) and the
  // globals are fixed for this scope's lifetime (derived values are assigned
  // once; a read before that throws, and throws aren't cached). Samplers call
  // the same function with the same arguments back to back — x(t) and y(t) of a
  // parametric both calling f(t), or p(k) constant across a repeat copy — so
  // this one-slot cache removes most nested evaluations.
  let lastArgs: unknown[] | null = null;
  let lastResult: unknown;
  return (...args: unknown[]) => {
    if (args.length !== params.length) {
      throw new Error(`${name} expects ${params.length} argument${params.length === 1 ? '' : 's'}`);
    }
    if (lastArgs && args.every((a, i) => a === lastArgs![i])) return lastResult;
    if (depth.n >= MAX_DEPTH) throw new Error('Functions nest too deeply');
    // Save/restore so re-entrant calls (f(f(1))) each see their own arguments.
    const saved = params.map((p) => local[p]);
    for (let i = 0; i < params.length; i++) local[params[i]] = args[i];
    depth.n++;
    try {
      const result = compiled.evaluate(local);
      lastArgs = args;
      lastResult = result;
      return result;
    } finally {
      depth.n--;
      for (let i = 0; i < params.length; i++) local[params[i]] = saved[i];
    }
  };
}

export function buildEvalContext(items: { entry: Entry; parsed: Parsed }[], opts: EvalOpts = {}): EvalContext {
  const scope: Record<string, unknown> = { ...HELPERS };
  const varNames = new Set<string>();
  const derivedNames = new Set<string>();
  const fnNames = new Set<string>();
  const derivedValues = new Map<string, number>();
  const derivedErrors = new Map<string, string>();

  for (const { entry, parsed } of items) {
    if (parsed.kind === 'variable') {
      scope[parsed.name] = entry.varValue ?? parsed.value;
      varNames.add(parsed.name);
    }
  }

  // User functions (closures over the live global scope object).
  const depth = { n: 0 };
  const fnDefs: FnDef[] = [];
  for (const { parsed } of items) {
    if (parsed.kind !== 'fndef' || fnNames.has(parsed.name) || varNames.has(parsed.name)) continue;
    fnNames.add(parsed.name);
    fnDefs.push(parsed);
  }
  // Derived values (`b = 2a`): names first, values in dependency order below.
  const pending: { entry: Entry; parsed: FnParsed }[] = [];
  for (const it of items) {
    if (!isDerived(it.parsed)) continue;
    const { name } = it.parsed;
    if (varNames.has(name) || fnNames.has(name) || derivedNames.has(name)) {
      derivedErrors.set(it.entry.id, `${name} is already defined`);
      continue;
    }
    derivedNames.add(name);
    pending.push({ entry: it.entry, parsed: it.parsed });
  }

  // Named points (A = (a, 1)): resolved with the derived values below, since
  // either may read the other (B = (A.x + 1, A.y), d = A.x^2).
  const pointNames = new Set<string>();
  const points = new Map<string, [number, number]>();
  const pointErrors = new Map<string, string>();
  const coordNames = new Set<string>();
  const pendingPoints: { entry: Entry; parsed: PointParsed }[] = [];
  for (const { entry, parsed } of items) {
    if (parsed.kind !== 'pointvar') continue;
    const { name } = parsed;
    if (varNames.has(name) || fnNames.has(name) || derivedNames.has(name) || pointNames.has(name)) {
      pointErrors.set(entry.id, `${name} is already defined`);
      continue;
    }
    pointNames.add(name);
    coordNames.add(coordSymbol(name, 'x'));
    coordNames.add(coordSymbol(name, 'y'));
    pendingPoints.push({ entry, parsed });
  }

  // ODE solutions y(T), y'(T): lazily integrated closures (names already
  // defined above win over them). An equation reading a point coordinate waits
  // for it like for a derived value.
  const solutions = installSolutions(items, scope, {
    varNames,
    derivedNames: coordNames.size ? new Set([...derivedNames, ...coordNames]) : derivedNames,
    fnNames,
    fnDefs,
    fixedStep: opts.odeStep,
  });

  // Links are untrusted: a body may only call known functions, other user
  // functions and ODE solutions — never mathjs internals like evaluate / createUnit.
  const callsOk = (node: Parameters<typeof calledFunctions>[0]) =>
    [...calledFunctions(node)].every((f) => KNOWN_FUNCTIONS.has(f) || fnNames.has(f) || solutions.names.has(f));
  for (const def of fnDefs) {
    scope[def.name] = callsOk(def.node)
      ? makeUserFn(def, scope, depth)
      : () => {
          throw new Error(`${def.name} calls an unknown function`);
        };
  }

  // Derived values and named points, resolved in dependency order by repeated
  // passes (each pass evaluates whatever has become computable). Leftovers are
  // cycles / errors. (A solution call whose equation reads a value not yet set
  // throws, so the value retries on a later pass.)
  type Item =
    | { entry: Entry; parsed: FnParsed; point?: undefined }
    | { entry: Entry; parsed: PointParsed; point: true };
  const waitsOn = (d: string) => (derivedNames.has(d) || coordNames.has(d)) && !(d in scope);
  const lastError = new Map<string, string>();
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN);
  let queue: Item[] = [...pending, ...pendingPoints.map((p) => ({ ...p, point: true as const }))];
  while (queue.length) {
    const next: Item[] = [];
    for (const it of queue) {
      if (it.parsed.deps.some(waitsOn)) {
        next.push(it);
        continue;
      }
      if (it.point) {
        const { name, tNode, yNode } = it.parsed;
        if (!callsOk(tNode) || !callsOk(yNode)) {
          pointErrors.set(it.entry.id, 'Unknown function');
          continue; // never evaluated (compute's validation names the function)
        }
        const sx = coordSymbol(name, 'x');
        const sy = coordSymbol(name, 'y');
        // Never shadow a function (an ODE solution's shielded name, a helper).
        if (typeof scope[sx] === 'function' || typeof scope[sy] === 'function') {
          pointErrors.set(it.entry.id, `${name} is a reserved name: rename the point`);
          continue;
        }
        try {
          const x = num(compileNode(tNode).evaluate(scope));
          const y = num(compileNode(yNode).evaluate(scope));
          scope[sx] = x;
          scope[sy] = y;
          if (Number.isFinite(x) && Number.isFinite(y)) points.set(name, [x, y]);
        } catch (err) {
          lastError.set(it.entry.id, err instanceof Error ? err.message : String(err));
          next.push(it);
        }
        continue;
      }
      const { name } = it.parsed;
      if (!callsOk(it.parsed.node)) {
        derivedErrors.set(it.entry.id, 'Unknown function');
        continue; // never evaluated (compute's validation names the function)
      }
      try {
        const n = num(compileNode(it.parsed.node).evaluate(scope));
        scope[name] = n;
        derivedValues.set(it.entry.id, n);
      } catch (err) {
        lastError.set(it.entry.id, err instanceof Error ? err.message : String(err));
        next.push(it);
      }
    }
    if (next.length === queue.length) {
      // What each leftover is waiting for: the items defining those names.
      const byName = new Map<string, Item>();
      for (const it of next) {
        if (it.point) {
          byName.set(coordSymbol(it.parsed.name, 'x'), it);
          byName.set(coordSymbol(it.parsed.name, 'y'), it);
        } else byName.set(it.parsed.name, it);
      }
      const onCycle = (start: Item): boolean => {
        const seen = new Set<Item>();
        const stack = [start];
        while (stack.length) {
          const cur = stack.pop()!;
          for (const d of cur.parsed.deps) {
            const dep = byName.get(d);
            if (!dep) continue;
            if (dep === start) return true;
            if (!seen.has(dep)) {
              seen.add(dep);
              stack.push(dep);
            }
          }
        }
        return false;
      };
      for (const it of next) {
        const blocked = it.parsed.deps.filter(waitsOn);
        const msg = onCycle(it)
          ? 'Circular definition'
          : blocked.length
            ? `${prettyCoords(blocked[0])} has no value yet`
            : prettyCoords(lastError.get(it.entry.id) ?? 'Could not evaluate');
        (it.point ? pointErrors : derivedErrors).set(it.entry.id, msg);
      }
      break;
    }
    queue = next;
  }

  // Key over every function definition and the global values bodies read.
  let fnKey = fnDefs
    .map((d) => `${d.raw}:${d.deps.map((x) => (typeof scope[x] === 'number' ? scope[x] : 'u')).join(',')}`)
    .join(';');
  if (solutions.names.size) fnKey += '|' + solutions.keyFor(fnDefs.flatMap((d) => [...calledFunctions(d.node)]));

  return {
    scope: scope as Record<string, number>,
    varNames,
    derivedNames,
    fnNames,
    derivedValues,
    derivedErrors,
    fnKey,
    solutions,
    pointNames,
    points,
    pointErrors,
  };
}
