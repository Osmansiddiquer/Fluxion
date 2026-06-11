import { parse as mjParse, derivative, simplify, type MathNode } from 'mathjs';
import { normalizeInput } from './normalize';
import { parsePoints, looksLikePoints, type PointSpec } from './points';

/**
 * Parsing & classification of a single sidebar entry.
 *
 * Independent variable: `t`. Dependent variable: `y` (or any identifier for a
 * system). Every equation is understood as the set of points satisfying it:
 *
 *  - contains a derivative           -> ODE (solved for its highest derivative)
 *  - linear in y, solvable as y=f(t) -> explicit function (rich feature support)
 *  - identifier = constant           -> variable (slider)
 *  - anything else (t=0, t²+y²=1, …) -> implicit relation F(t,y)=0 (contour)
 */

export const INDEP = 't';

const RESERVED = new Set([
  't', 'e', 'pi', 'tau', 'phi', 'i', 'Infinity', 'NaN', 'true', 'false', 'null',
  'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
]);

export type Parsed =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'variable'; name: string; value: number; raw: string }
  | {
      kind: 'function';
      name: string;
      node: MathNode;
      deps: string[];
      raw: string;
      lhs?: string;
      rhs?: string;
    }
  | {
      kind: 'ode';
      depVar: string;
      order: number;
      node: MathNode;
      deps: string[];
      stateSymbols: string[];
      lhs: string;
      rhs: string;
      raw: string;
    }
  | {
      kind: 'implicit';
      /** F where the curve is F(t, y) = 0. */
      node: MathNode;
      deps: string[];
      lhs: string;
      rhs: string;
      raw: string;
    }
  | {
      kind: 'points';
      points: PointSpec[];
      polyline: boolean;
      scattered: boolean;
      deps: string[];
      raw: string;
    }
  | {
      kind: 'pointvar';
      name: string;
      tNode: MathNode;
      yNode: MathNode;
      xSym?: string;
      ySym?: string;
      literal: boolean;
      deps: string[];
      raw: string;
    }
  | {
      kind: 'polar';
      rNode: MathNode;
      deps: string[];
      raw: string;
    };

const DERIV_TOKEN = /^D(\d+)_([A-Za-z]\w*)$/;

export { normalizeInput } from './normalize';

export function freeSymbols(node: MathNode): Set<string> {
  const names = new Set<string>();
  node.traverse((n: MathNode, path: string | null, parent: MathNode | null) => {
    if ((n as { type: string }).type === 'SymbolNode') {
      if (parent && (parent as { type: string }).type === 'FunctionNode' && path === 'fn') {
        return;
      }
      const name = (n as unknown as { name: string }).name;
      if (!RESERVED.has(name)) names.add(name);
    }
  });
  return names;
}

/** Names of functions actually called in the expression. */
export function calledFunctions(node: MathNode): Set<string> {
  const names = new Set<string>();
  node.traverse((n: MathNode) => {
    if ((n as { type: string }).type === 'FunctionNode') {
      const fn = (n as unknown as { fn: { name?: string } }).fn;
      if (fn && fn.name) names.add(fn.name);
    }
  });
  return names;
}

function stateSymbolsFor(depVar: string, order: number): string[] {
  const syms = [depVar];
  for (let k = 1; k < order; k++) syms.push(`D${k}_${depVar}`);
  return syms;
}

function splitEquation(s: string): [string, string] | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=') {
      const prev = s[i - 1];
      const next = s[i + 1];
      if (prev === '<' || prev === '>' || prev === '!' || prev === '=') continue;
      if (next === '=') continue;
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  return null;
}

function highestDerivative(
  symbols: Iterable<string>,
): { depVar: string; order: number } | 'ambiguous' | null {
  let maxOrder = 0;
  const varsAtMax = new Set<string>();
  for (const s of symbols) {
    const m = s.match(DERIV_TOKEN);
    if (!m) continue;
    const order = Number(m[1]);
    if (order > maxOrder) {
      maxOrder = order;
      varsAtMax.clear();
      varsAtMax.add(m[2]);
    } else if (order === maxOrder) {
      varsAtMax.add(m[2]);
    }
  }
  if (maxOrder === 0) return null;
  if (varsAtMax.size > 1) return 'ambiguous';
  return { depVar: [...varsAtMax][0], order: maxOrder };
}

function zeroOut(node: MathNode, symbol: string): MathNode {
  return node.transform((n: MathNode) =>
    (n as { isSymbolNode?: boolean }).isSymbolNode &&
    (n as unknown as { name: string }).name === symbol
      ? mjParse('0')
      : n,
  );
}

// Parsing (especially the symbolic ODE solve) is expensive and viewport-independent,
// so cache by raw text — this keeps pan/zoom and slider drags cheap.
const parseCache = new Map<string, Parsed>();

export function parseEntry(raw: string): Parsed {
  const hit = parseCache.get(raw);
  if (hit) return hit;
  const parsed = parseEntryUncached(raw);
  if (parseCache.size > 600) parseCache.clear();
  parseCache.set(raw, parsed);
  return parsed;
}

function parseEntryUncached(raw: string): Parsed {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  const normalized = normalizeInput(trimmed);

  // Point literals: (a,b), [(x,y),…], polyline(…), ((x,y),(x,y),…)
  if (looksLikePoints(normalized)) {
    try {
      const pts = parsePoints(normalized);
      if (pts) {
        const deps = new Set<string>();
        for (const p of pts.points) {
          if (p.ref) deps.add(p.ref);
          if (p.tNode) for (const s of freeSymbols(p.tNode)) deps.add(s);
          if (p.yNode) for (const s of freeSymbols(p.yNode)) deps.add(s);
        }
        return {
          kind: 'points',
          points: pts.points,
          polyline: pts.polyline,
          scattered: pts.scattered,
          deps: [...deps],
          raw,
        };
      }
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  const split = splitEquation(normalized);

  // No '=' -> bare expression, function of t.
  if (!split) {
    try {
      const node = mjParse(normalized);
      if ([...freeSymbols(node)].some((s) => DERIV_TOKEN.test(s))) {
        return { kind: 'error', message: 'Write the ODE as an equation, e.g. y′ = …' };
      }
      const deps = [...freeSymbols(node)].filter((s) => s !== INDEP);
      return { kind: 'function', name: 'y', node, deps, raw };
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  const [lhs, rhs] = split;
  if (!rhs) return { kind: 'error', message: 'Missing right-hand side' };

  // Point-valued variable: A = (x, y)
  if (/^[A-Za-z]\w*$/.test(lhs) && lhs !== INDEP && looksLikePoints(rhs)) {
    try {
      const pts = parsePoints(rhs);
      if (pts && pts.points.length === 1 && !pts.polyline) {
        const p = pts.points[0];
        if (p.tNode && p.yNode) {
          const deps = [...freeSymbols(p.tNode), ...freeSymbols(p.yNode)].filter((s) => s !== INDEP);
          return {
            kind: 'pointvar',
            name: lhs,
            tNode: p.tNode,
            yNode: p.yNode,
            xSym: p.xSym,
            ySym: p.ySym,
            literal: p.literal ?? false,
            deps,
            raw,
          };
        }
      }
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  // Polar curve: r = f(θ). r and θ are reserved for polar; plotted as the
  // parametric (x, y) = (r·cosθ, r·sinθ) over θ ∈ [0, 2π].
  if (lhs === 'r') {
    try {
      const rNode = mjParse(rhs);
      const deps = [...freeSymbols(rNode)].filter((s) => s !== 'θ' && s !== 'theta');
      return { kind: 'polar', rNode, deps, raw };
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  let combined: MathNode;
  try {
    combined = mjParse(`(${lhs}) - (${rhs})`);
  } catch (err) {
    return { kind: 'error', message: friendlyError(err) };
  }

  const high = highestDerivative(freeSymbols(combined));
  if (high === 'ambiguous') {
    return { kind: 'error', message: 'Ambiguous: isolate one derivative on a side' };
  }
  if (high) return parseODE(high.depVar, high.order, combined, lhs, rhs, raw);

  return parseRelation(lhs, rhs, combined, raw);
}

function parseODE(
  depVar: string,
  order: number,
  combined: MathNode,
  lhs: string,
  rhs: string,
  raw: string,
): Parsed {
  const H = `D${order}_${depVar}`;
  try {
    const a = simplify(derivative(combined, H));
    if (simplify(derivative(a, H)).toString() !== '0') {
      return { kind: 'error', message: 'Equation must be linear in the highest derivative' };
    }
    if (a.toString() === '0') {
      return { kind: 'error', message: `Could not solve for ${depVar}${'′'.repeat(order)}` };
    }
    const b = simplify(zeroOut(combined, H));
    const solved = simplify(mjParse(`-(${b.toString()})/(${a.toString()})`));
    const stateSymbols = stateSymbolsFor(depVar, order);
    const stateSet = new Set(stateSymbols);
    const deps = [...freeSymbols(solved)].filter((s) => s !== INDEP && !stateSet.has(s));
    return { kind: 'ode', depVar, order, node: solved, deps, stateSymbols, lhs, rhs, raw };
  } catch (err) {
    return { kind: 'error', message: friendlyError(err) };
  }
}

const IDENT = /^[A-Za-z]\w*$/;

function parseRelation(lhs: string, rhs: string, F: MathNode, raw: string): Parsed {
  // Try to read it as explicit-in-y: F linear in y -> y = f(t).
  try {
    const ay = simplify(derivative(F, 'y'));
    const ayConst = simplify(derivative(ay, 'y')).toString() === '0';
    if (ayConst && ay.toString() !== '0') {
      const b = simplify(zeroOut(F, 'y'));
      const solved = simplify(mjParse(`-(${b.toString()})/(${ay.toString()})`));
      const deps = [...freeSymbols(solved)].filter((s) => s !== INDEP);
      return { kind: 'function', name: 'y', node: solved, deps, raw, lhs, rhs };
    }
    if (ay.toString() === '0') {
      // No y. A lone identifier (not t/y) is a variable or named function of t.
      if (IDENT.test(lhs) && lhs !== INDEP && lhs !== 'y') {
        const node = mjParse(rhs);
        const deps = [...freeSymbols(node)];
        const depsNoT = deps.filter((s) => s !== INDEP);
        if (!deps.includes(INDEP) && depsNoT.length === 0) {
          const value = (node as unknown as { evaluate: () => unknown }).evaluate();
          if (typeof value === 'number' && Number.isFinite(value)) {
            return { kind: 'variable', name: lhs, value, raw };
          }
        }
        return { kind: 'function', name: lhs, node, deps: depsNoT, raw, lhs, rhs };
      }
      // Relation in t only (t = 0, t² = 1, …) -> implicit.
    }
  } catch {
    /* fall through to implicit */
  }
  const deps = [...freeSymbols(F)].filter((s) => s !== INDEP && s !== 'y');
  return { kind: 'implicit', node: F, deps, lhs, rhs, raw };
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s*\(char \d+\)$/, '');
}
