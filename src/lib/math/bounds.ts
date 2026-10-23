import type { MathNode } from 'mathjs';

/**
 * Interval bounds of an expression: a guaranteed enclosure [lo, hi] of every
 * value it takes while some variables sweep ranges (t ∈ [0, 2π]) and the rest
 * are fixed (sliders, loop variables). Used to skip sampling shapes that are
 * entirely off-screen — so it must never be too tight. Anything it can't bound
 * (user functions, helpers, unknown functions, non-numbers) is (-∞, ∞), which
 * simply means "don't cull".
 */
export type Interval = readonly [number, number];

export const UNBOUNDED: Interval = [-Infinity, Infinity];

const TWO_PI = Math.PI * 2;

function iv(a: number, b: number): Interval {
  if (Number.isNaN(a) || Number.isNaN(b)) return UNBOUNDED;
  return a <= b ? [a, b] : [b, a];
}
const isPoint = (x: Interval) => x[0] === x[1];
const finite = (x: Interval) => Number.isFinite(x[0]) && Number.isFinite(x[1]);

function add(a: Interval, b: Interval): Interval {
  return iv(a[0] + b[0], a[1] + b[1]);
}
function sub(a: Interval, b: Interval): Interval {
  return iv(a[0] - b[1], a[1] - b[0]);
}
function mul(a: Interval, b: Interval): Interval {
  if (!finite(a) || !finite(b)) {
    // 0 × ∞ is NaN; be conservative.
    if ((a[0] === 0 && a[1] === 0) || (b[0] === 0 && b[1] === 0)) return [0, 0];
    return UNBOUNDED;
  }
  const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return iv(Math.min(...p), Math.max(...p));
}
function div(a: Interval, b: Interval): Interval {
  if (b[0] <= 0 && b[1] >= 0) return UNBOUNDED;
  return mul(a, iv(1 / b[1], 1 / b[0]));
}
function monotone(f: (x: number) => number, a: Interval, increasing = true): Interval {
  const lo = f(a[0]);
  const hi = f(a[1]);
  return increasing ? iv(lo, hi) : iv(hi, lo);
}

/** sin over [lo, hi]: endpoints plus any crest / trough inside. */
function sinI(a: Interval): Interval {
  if (!finite(a)) return [-1, 1];
  if (a[1] - a[0] >= TWO_PI) return [-1, 1];
  let lo = Math.min(Math.sin(a[0]), Math.sin(a[1]));
  let hi = Math.max(Math.sin(a[0]), Math.sin(a[1]));
  // Crests at π/2 + 2πn, troughs at -π/2 + 2πn.
  const has = (c: number) => Math.ceil((a[0] - c) / TWO_PI) <= Math.floor((a[1] - c) / TWO_PI);
  if (has(Math.PI / 2)) hi = 1;
  if (has(-Math.PI / 2)) lo = -1;
  return [lo, hi];
}
function cosI(a: Interval): Interval {
  return sinI(add(a, [Math.PI / 2, Math.PI / 2]));
}

function powI(a: Interval, b: Interval): Interval {
  if (!isPoint(b)) {
    // x^y with x ≥ 1 and y ranging is monotone in both; otherwise give up.
    if (a[0] >= 1 && finite(b) && finite(a)) {
      const c = [a[0] ** b[0], a[0] ** b[1], a[1] ** b[0], a[1] ** b[1]];
      return iv(Math.min(...c), Math.max(...c));
    }
    if (a[0] > 0 && a[1] <= 1 && finite(b)) {
      const c = [a[0] ** b[0], a[0] ** b[1], a[1] ** b[0], a[1] ** b[1]];
      return iv(Math.min(...c), Math.max(...c));
    }
    return UNBOUNDED;
  }
  const n = b[0];
  if (Number.isInteger(n)) {
    if (n === 0) return [1, 1];
    if (n < 0) {
      if (a[0] <= 0 && a[1] >= 0) return UNBOUNDED;
      return div([1, 1], powI(a, [-n, -n]));
    }
    if (n % 2 === 1) return monotone((x) => x ** n, a);
    // even: minimum at 0 when the range straddles it
    const lo = a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(a[0] ** n, a[1] ** n);
    return iv(lo, Math.max(a[0] ** n, a[1] ** n));
  }
  if (a[0] < 0) return UNBOUNDED; // complex / undefined for negatives
  return n > 0 ? monotone((x) => x ** n, a) : monotone((x) => x ** n, a, false);
}

function modI(a: Interval, m: Interval): Interval {
  if (!isPoint(m) || !finite(a)) return m[0] > 0 ? [0, m[1]] : UNBOUNDED;
  const y = m[0];
  if (y === 0) return a;
  // Same period throughout → a plain shift; otherwise the whole period. mathjs
  // snaps a nearly-integer quotient up, so near a period boundary the value may
  // wrap: treat that as "the whole period" too.
  const near = (q: number) => Math.abs(q - Math.round(q)) <= 1e-6 * Math.max(1, Math.abs(q));
  const qa = a[0] / y;
  const qb = a[1] / y;
  const q0 = Math.floor(qa);
  if (q0 === Math.floor(qb) && !near(qa) && !near(qb)) return iv(a[0] - y * q0, a[1] - y * q0);
  const eps = Math.abs(y) * 1e-9;
  return [Math.min(0, y) - eps, Math.max(0, y) + eps];
}

const UNARY: Record<string, (a: Interval) => Interval> = {
  sin: sinI,
  cos: cosI,
  exp: (a) => monotone(Math.exp, a),
  sqrt: (a) => (a[0] < 0 ? UNBOUNDED : monotone(Math.sqrt, a)),
  cbrt: (a) => monotone(Math.cbrt, a),
  log: (a) => (a[0] <= 0 ? UNBOUNDED : monotone(Math.log, a)),
  log10: (a) => (a[0] <= 0 ? UNBOUNDED : monotone(Math.log10, a)),
  log2: (a) => (a[0] <= 0 ? UNBOUNDED : monotone(Math.log2, a)),
  abs: (a) => (a[0] >= 0 ? a : a[1] <= 0 ? iv(-a[1], -a[0]) : [0, Math.max(-a[0], a[1])]),
  atan: (a) => monotone(Math.atan, a),
  tanh: (a) => monotone(Math.tanh, a),
  sinh: (a) => monotone(Math.sinh, a),
  asinh: (a) => monotone(Math.asinh, a),
  cosh: (a) => (a[0] >= 0 ? monotone(Math.cosh, a) : a[1] <= 0 ? monotone(Math.cosh, a, false) : [1, Math.max(Math.cosh(a[0]), Math.cosh(a[1]))]),
  // mathjs snaps nearly-integer values in floor/ceil/round: widen by one step.
  floor: (a) => iv(Math.floor(a[0]) - 1, Math.floor(a[1]) + 1),
  ceil: (a) => iv(Math.ceil(a[0]) - 1, Math.ceil(a[1]) + 1),
  round: (a) => iv(Math.round(a[0]) - 1, Math.round(a[1]) + 1),
  sign: () => [-1, 1],
};

type Env = (name: string) => Interval | undefined;

function bound(node: MathNode, env: Env): Interval {
  const n = node as unknown as Record<string, unknown> & { type: string };
  switch (n.type) {
    case 'ConstantNode':
      return typeof n.value === 'number' ? [n.value, n.value] : UNBOUNDED;
    case 'SymbolNode':
      return env(n.name as string) ?? UNBOUNDED;
    case 'ParenthesisNode':
      return bound(n.content as MathNode, env);
    case 'ConditionalNode': {
      const a = bound(n.trueExpr as MathNode, env);
      const b = bound(n.falseExpr as MathNode, env);
      return iv(Math.min(a[0], b[0]), Math.max(a[1], b[1]));
    }
    case 'OperatorNode': {
      const args = (n.args as MathNode[]).map((a) => bound(a, env));
      switch (n.fn) {
        case 'add':
          return args.length === 2 ? add(args[0], args[1]) : UNBOUNDED;
        case 'subtract':
          return args.length === 2 ? sub(args[0], args[1]) : UNBOUNDED;
        case 'multiply':
          return args.length === 2 ? mul(args[0], args[1]) : UNBOUNDED;
        case 'divide':
          return args.length === 2 ? div(args[0], args[1]) : UNBOUNDED;
        case 'unaryMinus':
          return iv(-args[0][1], -args[0][0]);
        case 'unaryPlus':
          return args[0];
        case 'pow':
          return powI(args[0], args[1]);
        case 'mod':
          return modI(args[0], args[1]);
        default:
          return UNBOUNDED;
      }
    }
    case 'FunctionNode': {
      const fn = n.fn as { type?: string; name?: string };
      const name = fn.type === 'SymbolNode' ? fn.name! : '';
      // A scope function of that name (helper, user function) shadows built-ins.
      if (!name || env(`fn:${name}`)) return UNBOUNDED;
      const args = (n.args as MathNode[]).map((a) => bound(a, env));
      if (args.some((a) => Number.isNaN(a[0]))) return UNBOUNDED;
      if (UNARY[name] && args.length === 1) return UNARY[name](args[0]);
      if (name === 'mod' && args.length === 2) return modI(args[0], args[1]);
      if (name === 'pow' && args.length === 2) return powI(args[0], args[1]);
      if ((name === 'min' || name === 'max') && args.length >= 1) {
        const lo = args.map((a) => a[0]);
        const hi = args.map((a) => a[1]);
        return name === 'min' ? iv(Math.min(...lo), Math.min(...hi)) : iv(Math.max(...lo), Math.max(...hi));
      }
      if (name === 'hypot' && args.length >= 1) {
        const sq = args.map((a) => powI(a, [2, 2]));
        const s = sq.reduce((x, y) => add(x, y), [0, 0] as Interval);
        return monotone(Math.sqrt, iv(Math.max(0, s[0]), s[1]));
      }
      return UNBOUNDED;
    }
    default:
      return UNBOUNDED;
  }
}

/**
 * Bounds of `node` with `ranges` sweeping (e.g. { t: [0, 2π] }) and every other
 * name read from `scope` (numbers only; a scope function shadowing a built-in
 * makes its call unbounded). Pads outward so floating-point rounding can never
 * make the enclosure too tight.
 */
export function boundsOf(
  node: MathNode,
  scope: Record<string, unknown>,
  ranges: Record<string, Interval>,
): Interval {
  const env: Env = (name) => {
    if (name.startsWith('fn:')) return typeof scope[name.slice(3)] === 'function' ? UNBOUNDED : undefined;
    if (name in ranges) return ranges[name];
    const v = scope[name];
    if (typeof v === 'number') return Number.isNaN(v) ? UNBOUNDED : [v, v];
    if (name === 'pi') return [Math.PI, Math.PI];
    if (name === 'e') return [Math.E, Math.E];
    if (name === 'tau') return [TWO_PI, TWO_PI];
    if (name === 'phi') return [1.618033988749895, 1.618033988749895];
    return undefined;
  };
  let r: Interval;
  try {
    r = bound(node, env);
  } catch {
    return UNBOUNDED;
  }
  const pad = (x: number) => 1e-9 * Math.max(1, Math.abs(x));
  return [r[0] - pad(r[0]), r[1] + pad(r[1])];
}

/** Bounding box of a parametric curve (x(t), y(t)) over [t0, t1], split into
 * `pieces` sub-ranges for a tighter enclosure. */
export function parametricBox(
  xNode: MathNode,
  yNode: MathNode,
  scope: Record<string, unknown>,
  t0: number,
  t1: number,
  pieces = 4,
): { x: Interval; y: Interval } {
  let xl = Infinity;
  let xh = -Infinity;
  let yl = Infinity;
  let yh = -Infinity;
  const lo = Math.min(t0, t1);
  const span = Math.abs(t1 - t0);
  for (let i = 0; i < pieces; i++) {
    const r: Interval = [lo + (span * i) / pieces, lo + (span * (i + 1)) / pieces];
    const bx = boundsOf(xNode, scope, { t: r });
    const by = boundsOf(yNode, scope, { t: r });
    xl = Math.min(xl, bx[0]);
    xh = Math.max(xh, bx[1]);
    yl = Math.min(yl, by[0]);
    yh = Math.max(yh, by[1]);
  }
  return { x: [xl, xh], y: [yl, yh] };
}

/** Polar r = f(θ) over [θ0, θ1]: the disc of the largest |r|. */
export function polarBox(
  rNode: MathNode,
  scope: Record<string, unknown>,
  th0: number,
  th1: number,
): { x: Interval; y: Interval } {
  const r = boundsOf(rNode, scope, { θ: iv(th0, th1), theta: iv(th0, th1) });
  const R = Math.max(Math.abs(r[0]), Math.abs(r[1]));
  return { x: [-R, R], y: [-R, R] };
}

/** Does the box miss the (margin-expanded) view rectangle entirely? */
export function boxOutside(
  box: { x: Interval; y: Interval },
  view: { tMin: number; tMax: number; yMin: number; yMax: number },
  margin: number,
): boolean {
  return (
    box.x[1] < view.tMin - margin ||
    box.x[0] > view.tMax + margin ||
    box.y[1] < view.yMin - margin ||
    box.y[0] > view.yMax + margin
  );
}
