import * as M from 'mathjs';
import type { EvalFunction, MathNode } from 'mathjs';

/**
 * A faster evaluator for mathjs expression trees, with the same results.
 *
 * `node.compile()` from mathjs dispatches every operator through a typed
 * function (`add`, `multiply`, …) and wraps the scope in a Map on every call.
 * Sampling evaluates the same tree thousands of times per frame, so that
 * overhead dominates. This compiler turns a tree into plain JS closures:
 *
 *  - Arithmetic on numbers runs natively (`a + b`); anything that isn't a
 *    plain number (booleans, matrices, complex) goes to the mathjs function,
 *    so results are identical. A few hot functions (sin, cos, sqrt, mod, …)
 *    run natively inside the domain where they're provably the same as
 *    mathjs, and delegate outside it (sqrt of a negative → mathjs Complex).
 *  - Loop-invariant sub-expressions are hoisted: a costly subtree that doesn't
 *    read the sample variables (t, x, y, r, θ, ODE state, function params) is
 *    memoised on the values of the names it reads. During a sweep over t those
 *    values don't change, so `mod(T*0.4 + 3k, 48)` is computed once per copy
 *    per frame instead of once per sample. The memo compares values, never
 *    scope identity, so it is correct however a caller mutates its scope.
 *  - Repeated subtrees share one memo (common-subexpression elimination), so
 *    `where` locals and copy-pasted terms are evaluated once per sample.
 *
 * Any node type it doesn't handle (indexing, arrays, assignments, …) is
 * embedded as a mathjs-compiled subtree. If the fast path throws, the whole
 * expression is re-evaluated with mathjs, so error messages (and the rare
 * lazily-evaluated `and` / `or`) behave exactly as before.
 */

type Scope = Record<string, unknown>;
type Ev = (s: Scope) => unknown;

const MATH = M as unknown as Record<string, unknown>;

/** Names that change on every sample of a sweep (never worth memoising on). */
export const SAMPLE_VARS = new Set(['t', 'x', 'y', 'r', 'θ', 'theta']);
const DERIV = /^D\d+_/;
/** Functions whose results aren't a pure function of their arguments. */
const IMPURE = new Set(['random', 'randomInt', 'pickRandom']);
/** mathjs functions with an expression-level transform (1-based indices, lazy
 * args): leave those to mathjs so the semantics stay exactly the same. */
const TRANSFORMED = new Set([
  'apply', 'column', 'concat', 'diff', 'filter', 'forEach', 'index', 'map', 'mapSlices', 'max', 'mean', 'min',
  'range', 'row', 'subset', 'std', 'sum', 'variance', 'quantileSeq', 'cumsum', 'and', 'or', 'nullish',
  'bitAnd', 'bitOr', 'print', 'evaluate', 'import', 'createUnit', 'parse', 'compile', 'simplify', 'derivative',
]);
const MEMO_MAX_READS = 8;

class Unsupported extends Error {}
/** Thrown by the fast path when it can't decide (an unresolved name, an odd
 * condition type): the expression is then re-evaluated by mathjs. Errors from
 * called functions propagate unchanged — mathjs would raise the same ones, and
 * re-running nested user functions on every error would be exponential. */
class FastMiss extends Error {}

function unsafeName(name: string): boolean {
  return name === '__proto__' || name in Object.prototype;
}

/** Inside this distance of an integer, floor/ceil/mod defer to mathjs (which
 * snaps nearly-integer values). Far outside mathjs' 1e-12 relative tolerance. */
function nearInteger(q: number): boolean {
  return Math.abs(q - Math.round(q)) <= 1e-6 * Math.max(1, Math.abs(q));
}

const num = (v: unknown): v is number => typeof v === 'number';

/** Native versions, used only for number arguments inside the domain where they
 * equal mathjs bit for bit (asserted by fastCompile.test.ts). */
const NATIVE: Record<string, { arity: number; f: (...a: number[]) => unknown }> = {
  sin: { arity: 1, f: Math.sin },
  cos: { arity: 1, f: Math.cos },
  tan: { arity: 1, f: Math.tan },
  atan: { arity: 1, f: Math.atan },
  exp: { arity: 1, f: Math.exp },
  abs: { arity: 1, f: Math.abs },
  sinh: { arity: 1, f: Math.sinh },
  cosh: { arity: 1, f: Math.cosh },
  tanh: { arity: 1, f: Math.tanh },
  atan2: { arity: 2, f: Math.atan2 },
  sqrt: { arity: 1, f: (x) => (x >= 0 ? Math.sqrt(x) : M.sqrt(x)) },
  log: { arity: 1, f: (x) => (x >= 0 ? Math.log(x) : M.log(x)) },
  asin: { arity: 1, f: (x) => (x >= -1 && x <= 1 ? Math.asin(x) : M.asin(x)) },
  acos: { arity: 1, f: (x) => (x >= -1 && x <= 1 ? Math.acos(x) : M.acos(x)) },
  floor: { arity: 1, f: (x) => (Number.isFinite(x) && !nearInteger(x) ? Math.floor(x) : M.floor(x)) },
  ceil: { arity: 1, f: (x) => (Number.isFinite(x) && !nearInteger(x) ? Math.ceil(x) : M.ceil(x)) },
  mod: { arity: 2, f: nativeMod },
};

function nativeMod(x: number, y: number): number {
  if (y === 0) return x;
  const q = x / y;
  if (Number.isFinite(q) && !nearInteger(q)) return x - y * Math.floor(q);
  return M.mod(x, y) as number;
}

function powNum(a: unknown, b: unknown): unknown {
  if (num(a) && num(b) && Number.isFinite(a) && Number.isFinite(b) && (a >= 0 || Number.isInteger(b))) {
    return Math.pow(a, b);
  }
  return M.pow(a as number, b as number);
}

function testCondition(c: unknown): boolean {
  if (typeof c === 'boolean') return c;
  if (typeof c === 'number') return c !== 0;
  if (c === null || c === undefined) return false;
  throw new FastMiss('condition type'); // let mathjs decide (BigNumber, Unit, …)
}

interface Built {
  ev: Ev;
  syms: Set<string>;
  fns: Set<string>;
  /** Reads a per-sample variable. */
  hot: boolean;
  /** Contains a call / pow / mod / conditional (worth memoising). */
  costly: boolean;
  pure: boolean;
}

function memo(inner: Ev, syms: string[], fns: string[]): Ev {
  const n = syms.length;
  const m = fns.length;
  const lastS = new Array<unknown>(n);
  const lastF = new Array<unknown>(m);
  let has = false;
  let val: unknown;
  return (s) => {
    let same = has;
    for (let i = 0; i < n; i++) {
      const v = s[syms[i]];
      if (v === undefined) return inner(s); // unresolved: let it throw normally
      // (0 and -0 are different inputs: atan2(0, -0) ≠ atan2(0, 0).)
      if (v !== lastS[i] || (v === 0 && 1 / (v as number) !== 1 / (lastS[i] as number))) same = false;
    }
    if (same) {
      for (let i = 0; i < m; i++) if (s[fns[i]] !== lastF[i]) same = false;
      if (same) return val;
    }
    has = false;
    for (let i = 0; i < n; i++) lastS[i] = s[syms[i]];
    for (let i = 0; i < m; i++) lastF[i] = s[fns[i]];
    val = inner(s);
    has = true;
    return val;
  };
}

class Builder {
  /** Shared (memoised) closures by subtree text: common-subexpression reuse. */
  private shared = new Map<string, Built>();
  constructor(private varying: Set<string>) {}

  private isHot(name: string): boolean {
    return SAMPLE_VARS.has(name) || this.varying.has(name) || DERIV.test(name);
  }

  build(node: MathNode): Built {
    const b = this.raw(node);
    if (!b.costly || !b.pure) return b;
    const reads = b.syms.size + b.fns.size;
    if (reads > MEMO_MAX_READS) return b;
    // Invariant over a sweep → memoise; a repeated subtree → share one memo.
    // A per-sample (hot) subtree that occurs once would miss every time, so it
    // is only memoised when it repeats (then the second use is a hit).
    const key = node.toString();
    if (b.hot && (this.counts.get(key) ?? 0) < 2) return b;
    const prev = this.shared.get(key);
    if (prev) return prev;
    const out: Built = { ...b, ev: memo(b.ev, [...b.syms], [...b.fns]) };
    this.shared.set(key, out);
    return out;
  }

  /** Occurrences of every subtree's text (for common-subexpression sharing). */
  private counts = new Map<string, number>();
  countSubtrees(root: MathNode): void {
    root.traverse((n: MathNode) => {
      const t = (n as { type?: string }).type;
      if (t !== 'FunctionNode' && t !== 'OperatorNode' && t !== 'ConditionalNode') return;
      const k = n.toString();
      this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    });
  }

  private embed(node: MathNode): Built {
    const c = node.compile();
    const syms = new Set<string>();
    const fns = new Set<string>();
    let pure = true;
    node.traverse((n: MathNode, path: string | null, parent: MathNode | null) => {
      const t = (n as { type?: string }).type;
      if (t === 'SymbolNode') {
        const name = (n as unknown as { name: string }).name;
        if (parent && (parent as { type?: string }).type === 'FunctionNode' && path === 'fn') {
          fns.add(name);
          if (IMPURE.has(name)) pure = false;
        } else syms.add(name);
      } else if (t === 'AssignmentNode' || t === 'FunctionAssignmentNode') pure = false;
    });
    for (const s of [...syms, ...fns]) if (unsafeName(s)) throw new Unsupported(s);
    return {
      ev: (s) => c.evaluate(s),
      syms,
      fns,
      hot: [...syms].some((s) => this.isHot(s)),
      costly: true,
      pure,
    };
  }

  private raw(node: MathNode): Built {
    const n = node as unknown as Record<string, unknown> & { type: string };
    switch (n.type) {
      case 'ConstantNode': {
        const v = n.value;
        return { ev: () => v, syms: new Set(), fns: new Set(), hot: false, costly: false, pure: true };
      }
      case 'SymbolNode': {
        const name = n.name as string;
        if (unsafeName(name)) throw new Unsupported(name);
        const ev: Ev = (s) => {
          const v = s[name];
          if (v !== undefined) return v;
          if (name in s) return v;
          if (name in MATH) return MATH[name];
          throw new FastMiss(name); // mathjs may still resolve it (units) or name the error
        };
        return { ev, syms: new Set([name]), fns: new Set(), hot: this.isHot(name), costly: false, pure: true };
      }
      case 'ParenthesisNode':
        return this.build(n.content as MathNode);
      case 'OperatorNode':
        return this.operator(n.fn as string, n.args as MathNode[], node);
      case 'FunctionNode':
        return this.call(node);
      case 'ConditionalNode': {
        const c = this.build(n.condition as MathNode);
        const a = this.build(n.trueExpr as MathNode);
        const b = this.build(n.falseExpr as MathNode);
        const C = c.ev;
        const A = a.ev;
        const B = b.ev;
        return {
          ev: (s) => (testCondition(C(s)) ? A(s) : B(s)),
          ...merge([c, a, b]),
          costly: true,
        };
      }
      default:
        return this.embed(node);
    }
  }

  private operator(fn: string, argNodes: MathNode[], node: MathNode): Built {
    const args = argNodes.map((a) => this.build(a));
    const info = merge(args);
    const bin = (native: (a: number, b: number) => unknown, slow: (a: unknown, b: unknown) => unknown, costly = false): Built => {
      if (args.length !== 2) return this.embed(node);
      const A = args[0].ev;
      const B = args[1].ev;
      return {
        ev: (s) => {
          const a = A(s);
          const b = B(s);
          return num(a) && num(b) ? native(a, b) : slow(a, b);
        },
        ...info,
        costly: info.costly || costly,
      };
    };
    switch (fn) {
      case 'add':
        return bin((a, b) => a + b, (a, b) => M.add(a as number, b as number));
      case 'subtract':
        return bin((a, b) => a - b, (a, b) => M.subtract(a as number, b as number));
      case 'multiply':
        return bin((a, b) => a * b, (a, b) => M.multiply(a as number, b as number));
      case 'divide':
        return bin((a, b) => a / b, (a, b) => M.divide(a as number, b as number));
      case 'pow':
        return bin(powNum, powNum, true);
      case 'mod':
        return bin(nativeMod, (a, b) => M.mod(a as number, b as number), true);
      case 'unaryMinus':
      case 'unaryPlus': {
        if (args.length !== 1) return this.embed(node);
        const A = args[0].ev;
        const neg = fn === 'unaryMinus';
        return {
          ev: (s) => {
            const a = A(s);
            if (num(a)) return neg ? -a : a;
            return neg ? M.unaryMinus(a as number) : M.unaryPlus(a as number);
          },
          ...info,
        };
      }
      default: {
        const f = MATH[fn];
        if (typeof f !== 'function' || TRANSFORMED.has(fn)) return this.embed(node);
        const call = f as (...a: unknown[]) => unknown;
        const evs = args.map((a) => a.ev);
        const ev: Ev =
          evs.length === 1
            ? (s) => call(evs[0](s))
            : evs.length === 2
              ? (s) => call(evs[0](s), evs[1](s))
              : (s) => call(...evs.map((e) => e(s)));
        return { ev, ...info, costly: true };
      }
    }
  }

  private call(node: MathNode): Built {
    const n = node as unknown as { fn: MathNode & { type: string; name?: string }; args: MathNode[] };
    if (n.fn.type !== 'SymbolNode' || !n.fn.name) return this.embed(node);
    const name = n.fn.name;
    if (unsafeName(name) || TRANSFORMED.has(name)) return this.embed(node);
    const args = n.args.map((a) => this.build(a));
    const info = merge(args);
    info.fns.add(name);
    if (IMPURE.has(name)) info.pure = false;
    const nat = NATIVE[name] && NATIVE[name].arity === args.length ? NATIVE[name].f : undefined;
    const builtin = MATH[name];
    const fallback = typeof builtin === 'function' ? (builtin as (...a: unknown[]) => unknown) : undefined;
    // A function in the scope (helpers, user functions) wins over the built-in,
    // exactly like mathjs' own resolution.
    const resolve = (s: Scope): ((...a: unknown[]) => unknown) | null => {
      const f = s[name];
      if (f !== undefined || name in s) {
        if (typeof f === 'function') return f as (...a: unknown[]) => unknown;
        throw new FastMiss(name);
      }
      return null;
    };
    const missing = () => {
      throw new FastMiss(name);
    };
    const evs = args.map((a) => a.ev);
    let ev: Ev;
    if (evs.length === 1) {
      const A = evs[0];
      ev = (s) => {
        const f = resolve(s);
        const a = A(s);
        if (f) return f(a);
        if (nat && num(a)) return nat(a);
        return fallback ? fallback(a) : missing();
      };
    } else if (evs.length === 2) {
      const [A, B] = evs;
      ev = (s) => {
        const f = resolve(s);
        const a = A(s);
        const b = B(s);
        if (f) return f(a, b);
        if (nat && num(a) && num(b)) return nat(a, b);
        return fallback ? fallback(a, b) : missing();
      };
    } else {
      ev = (s) => {
        const f = resolve(s);
        const vals = evs.map((e) => e(s));
        if (f) return f(...vals);
        return fallback ? fallback(...vals) : missing();
      };
    }
    return { ev, ...info, costly: true };
  }
}

function merge(parts: Built[]): Omit<Built, 'ev'> {
  const syms = new Set<string>();
  const fns = new Set<string>();
  let hot = false;
  let costly = false;
  let pure = true;
  for (const p of parts) {
    for (const s of p.syms) syms.add(s);
    for (const f of p.fns) fns.add(f);
    hot ||= p.hot;
    costly ||= p.costly;
    pure &&= p.pure;
  }
  return { syms, fns, hot, costly, pure };
}

/**
 * Compile a mathjs node to a fast evaluator with mathjs' semantics.
 * `varying` names extra per-call variables (ODE state symbols, user-function
 * parameters) so they're never treated as loop-invariant.
 */
export function fastCompile(node: MathNode, varying: Iterable<string> = []): EvalFunction {
  let slow: EvalFunction | null = null;
  const getSlow = () => (slow ??= node.compile());
  let fast: Ev;
  try {
    const b = new Builder(new Set(varying));
    b.countSubtrees(node);
    fast = b.build(node).ev;
  } catch (err) {
    if (err instanceof Unsupported) return getSlow();
    throw err;
  }
  return {
    evaluate(scope: Scope = {}) {
      try {
        return fast(scope);
      } catch (err) {
        // Exact mathjs behaviour wherever the fast path couldn't decide.
        if (err instanceof FastMiss) return getSlow().evaluate(scope);
        throw err;
      }
    },
  } as EvalFunction;
}
