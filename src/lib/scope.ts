import { calledFunctions, hasSymbol, type Parsed } from './math/parse';
import { KNOWN_FUNCTIONS } from './math/builtins';
import { compileNode } from './math/compileCache';
import { HELPERS } from './math/helpers';
import type { Entry } from '../store/types';

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
  /** Changes whenever any user function's definition or captured values change. */
  fnKey: string;
}

type FnDef = Extract<Parsed, { kind: 'fndef' }>;
type FnParsed = Extract<Parsed, { kind: 'function' }>;

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

export function buildEvalContext(items: { entry: Entry; parsed: Parsed }[]): EvalContext {
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
  // Links are untrusted: a body may only call known functions and other user
  // functions — never mathjs internals like evaluate / createUnit.
  const callsOk = (node: Parameters<typeof calledFunctions>[0]) =>
    [...calledFunctions(node)].every((f) => KNOWN_FUNCTIONS.has(f) || fnNames.has(f));
  for (const def of fnDefs) {
    scope[def.name] = callsOk(def.node)
      ? makeUserFn(def, scope, depth)
      : () => {
          throw new Error(`${def.name} calls an unknown function`);
        };
  }

  // Derived values, resolved in dependency order by repeated passes (each pass
  // evaluates whatever has become computable). Leftovers are cycles / errors.
  let pending: { entry: Entry; parsed: FnParsed }[] = [];
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
  const lastError = new Map<string, string>();
  while (pending.length) {
    const next: typeof pending = [];
    for (const it of pending) {
      const { name, deps } = it.parsed;
      if (deps.some((d) => derivedNames.has(d) && !(d in scope))) {
        next.push(it);
        continue;
      }
      if (!callsOk(it.parsed.node)) {
        derivedErrors.set(it.entry.id, 'Unknown function');
        continue; // never evaluated (compute's validation names the function)
      }
      try {
        const v = compileNode(it.parsed.node).evaluate(scope);
        const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN;
        scope[name] = n;
        derivedValues.set(it.entry.id, n);
      } catch (err) {
        lastError.set(it.entry.id, err instanceof Error ? err.message : String(err));
        next.push(it);
      }
    }
    if (next.length === pending.length) {
      for (const it of next) {
        const circular = it.parsed.deps.some((d) => derivedNames.has(d) && !(d in scope));
        derivedErrors.set(
          it.entry.id,
          circular ? 'Circular definition' : (lastError.get(it.entry.id) ?? 'Could not evaluate'),
        );
      }
      break;
    }
    pending = next;
  }

  // Key over every function definition and the global values bodies read.
  const fnKey = fnDefs
    .map((d) => `${d.raw}:${d.deps.map((x) => (typeof scope[x] === 'number' ? scope[x] : 'u')).join(',')}`)
    .join(';');

  return {
    scope: scope as Record<string, number>,
    varNames,
    derivedNames,
    fnNames,
    derivedValues,
    derivedErrors,
    fnKey,
  };
}
