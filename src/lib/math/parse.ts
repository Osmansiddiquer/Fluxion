import { parse as mjParse, derivative, simplify, type MathNode } from 'mathjs';
import { normalizeInput } from './normalize';
import { parsePoints, looksLikePoints, type PointSpec } from './points';
import { KNOWN_FUNCTIONS } from './builtins';
import { HELPER_NAMES } from './helpers';

const HELPERS_SET = new Set(HELPER_NAMES);

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
    }
  | {
      kind: 'inequality';
      /** AND of constraints; the region is where every `node` satisfies its `op` 0. */
      parts: { node: MathNode; op: IneqOp }[];
      /** Comparison chains (one per &-conjunct) for display. */
      conjuncts: { operands: string[]; ops: IneqOp[] }[];
      /** Uses r/θ — a polar region, so a θ-sweep range applies. */
      polar: boolean;
      deps: string[];
      raw: string;
    }
  | {
      /** Parametric curve (x(t), y(t)) swept over a t-range (thetaMin…thetaMax). */
      kind: 'parametric';
      xNode: MathNode;
      yNode: MathNode;
      deps: string[];
      raw: string;
    }
  | {
      /** User function definition `f(a, b) = body`, callable from any expression. */
      kind: 'fndef';
      name: string;
      params: string[];
      node: MathNode;
      /** Free names in the body other than the parameters. */
      deps: string[];
      rhs: string;
      raw: string;
    }
  | {
      /** `body for k = a..b[, j = c..d]` — the body drawn once per loop value. */
      kind: 'repeat';
      body: Parsed;
      loops: LoopSpec[];
      deps: string[];
      bodyRaw: string;
      raw: string;
    }
  | {
      /** `frames(i)` — frame i of the entry's imported frame sequence (filled contours). */
      kind: 'frames';
      indexNode: MathNode;
      deps: string[];
      raw: string;
    };

/** One loop of a repeat: name runs from..to (inclusive) in steps of `step`. */
export interface LoopSpec {
  name: string;
  from: MathNode;
  to: MathNode;
  step?: MathNode;
  /** Range text as typed (for display). */
  text: string;
}

/** Entry kinds a `for` repeat can wrap. */
export const REPEATABLE_KINDS = new Set([
  'function',
  'implicit',
  'polar',
  'parametric',
  'points',
  'inequality',
]);

export type IneqOp = '<' | '>' | '<=' | '>=';

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

/** Split a string on a separator char at the top level (outside ()/[]). */
function splitTopChar(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Split a comparison chain (a < b <= c) into its operands and operators. */
function splitComparisons(s: string): { operands: string[]; ops: IneqOp[] } {
  const operands: string[] = [];
  const ops: IneqOp[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === '<' || c === '>')) {
      operands.push(s.slice(start, i).trim());
      const two = s[i + 1] === '=';
      ops.push((two ? c + '=' : c) as IneqOp);
      if (two) i++;
      start = i + 1;
    }
  }
  operands.push(s.slice(start).trim());
  return { operands, ops };
}

/** Parse a (possibly compound) inequality: chained a<b<c and &-joined conjuncts. */
function parseInequality(
  s: string,
): { conjuncts: { operands: string[]; ops: IneqOp[] }[] } | null {
  if (!/[<>]/.test(s)) return null;
  const conjuncts = splitTopChar(s, '&')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(splitComparisons);
  if (conjuncts.some((c) => c.ops.length === 0)) return null;
  return { conjuncts };
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

/** Does the node reference `name` as a symbol (not a function name)? */
export function hasSymbol(node: MathNode, name: string): boolean {
  let found = false;
  node.traverse((n: MathNode, path: string | null, parent: MathNode | null) => {
    if ((n as { type: string }).type !== 'SymbolNode') return;
    if (parent && (parent as { type: string }).type === 'FunctionNode' && path === 'fn') return;
    if ((n as unknown as { name: string }).name === name) found = true;
  });
  return found;
}

/** x is the independent variable when it's used and t isn't (Desmos-style). When
 * both appear, t is independent and x is just a (possibly undefined) variable. */
function xIsIndependent(node: MathNode): boolean {
  return hasSymbol(node, 'x') && !hasSymbol(node, 't');
}

/** Rewrite every standalone `x` to `t` so x can serve as the horizontal axis. */
function rewriteXtoT(node: MathNode): MathNode {
  return node.transform((n) =>
    (n as { isSymbolNode?: boolean }).isSymbolNode &&
    (n as unknown as { name: string }).name === 'x'
      ? mjParse('t')
      : n,
  );
}

function rewriteXtoTStr(expr: string): string {
  try {
    return rewriteXtoT(mjParse(expr)).toString();
  } catch {
    return expr;
  }
}

/** Index of the last top-level `for` keyword (outside brackets), or -1. */
function findFor(s: string): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (
      depth === 0 &&
      c === 'f' &&
      s.startsWith('for', i) &&
      !/[A-Za-z0-9_]/.test(s[i - 1] ?? ' ') &&
      // …followed by a loop clause `k = a..b` (rules out names like "forward").
      /^\s*[A-Za-z]\w*\s*=[^=]*\.\./.test(s.slice(i + 3))
    ) {
      found = i;
    }
  }
  return found;
}

const LOOP_RESERVED = new Set(['t', 'x', 'y', 'r', 'theta', 'θ', 'e', 'pi', 'tau', 'phi']);

/** Parse `k = 0..5`, `k = [0...5]`, `k = 1..9 step 2` loop clauses (comma separated). */
export function parseLoops(text: string): LoopSpec[] {
  const clauses = splitTopChar(text, ',').map((c) => c.trim()).filter(Boolean);
  if (!clauses.length) throw new Error('Expected a loop like: for k = 0..5');
  const loops: LoopSpec[] = [];
  for (const clause of clauses) {
    const m = /^([A-Za-z]\w*)\s*=\s*(.+)$/.exec(clause);
    if (!m) throw new Error('Expected a loop like: for k = 0..5');
    const name = m[1];
    if (LOOP_RESERVED.has(name)) throw new Error(`Loop variable can't be ${name}`);
    if (loops.some((l) => l.name === name)) throw new Error(`Loop variable ${name} repeated`);
    let range = m[2].trim();
    let stepText: string | undefined;
    const sm = /^(.*?)\s+step\s+(.+)$/.exec(range);
    if (sm) {
      range = sm[1].trim();
      stepText = sm[2].trim();
    }
    if (range.startsWith('[') && range.endsWith(']')) range = range.slice(1, -1).trim();
    const dots = /^(.+?)\s*\.{2,3}\s*(.+)$/.exec(range);
    if (!dots) throw new Error('Loop range must look like a..b');
    loops.push({
      name,
      from: mjParse(dots[1]),
      to: mjParse(dots[2]),
      step: stepText ? mjParse(stepText) : undefined,
      text: m[2].trim(),
    });
  }
  return loops;
}

/** Concrete values of a loop given evaluated bounds (inclusive, capped). */
export function loopValues(from: number, to: number, step = 1, cap = 4096): number[] {
  if (![from, to, step].every(Number.isFinite) || step === 0) return [];
  const s = Math.abs(step) * (to >= from ? 1 : -1);
  const n = Math.floor((to - from) / s + 1e-9) + 1;
  const out: number[] = [];
  for (let i = 0; i < Math.min(n, cap); i++) out.push(from + i * s);
  return out;
}

function parseRepeat(trimmed: string, at: number, raw: string): Parsed {
  const bodyRaw = trimmed.slice(0, at).trim();
  const loopText = trimmed.slice(at + 3).trim();
  if (!bodyRaw) return { kind: 'error', message: 'Nothing to repeat before "for"' };
  let loops: LoopSpec[];
  try {
    loops = parseLoops(normalizeInput(loopText));
  } catch (err) {
    return { kind: 'error', message: friendlyError(err) };
  }
  const body = parseEntry(bodyRaw);
  if (body.kind === 'error') return body;
  if (!REPEATABLE_KINDS.has(body.kind)) {
    return { kind: 'error', message: `A ${body.kind} can't be repeated with "for"` };
  }
  const loopNames = new Set(loops.map((l) => l.name));
  const deps = new Set<string>();
  for (const d of (body as { deps: string[] }).deps) if (!loopNames.has(d)) deps.add(d);
  // Bounds may use globals and earlier loop variables (for i = 0..3, j = i..3).
  for (const l of loops) {
    for (const n of [l.from, l.to, l.step]) {
      if (n) for (const s of freeSymbols(n)) if (!loopNames.has(s)) deps.add(s);
    }
  }
  return { kind: 'repeat', body, loops, deps: [...deps], bodyRaw, raw };
}

const FNDEF_LHS = /^([A-Za-z]\w*)\s*\(\s*([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*)\s*\)$/;
const FN_RESERVED = new Set(['y', 'r', 't', 'x', 'frames', 'e', 'pi', 'tau', 'phi', 'i']);

/** `f(a, b) = body` → a function definition, or null if lhs isn't that shape. */
function parseFnDef(lhs: string, rhs: string, raw: string): Parsed | null {
  const m = FNDEF_LHS.exec(lhs);
  if (!m) return null;
  const name = m[1];
  if (FN_RESERVED.has(name) || KNOWN_FUNCTIONS.has(name) || DERIV_TOKEN.test(name)) return null;
  const params = m[2].split(',').map((p) => p.trim());
  if (new Set(params).size !== params.length) {
    return { kind: 'error', message: `Repeated parameter in ${name}(…)` };
  }
  if (params.some((p) => ['e', 'pi', 'tau', 'phi'].includes(p))) {
    return { kind: 'error', message: 'A parameter name is a constant' };
  }
  try {
    const node = mjParse(rhs);
    if (hasSymbol(node, 't') && !params.includes('t')) {
      return { kind: 'error', message: `Add t as a parameter: ${name}(…, t)` };
    }
    if (calledFunctions(node).has(name)) {
      return { kind: 'error', message: `${name} can't call itself` };
    }
    const ps = new Set(params);
    const deps = [...freeSymbols(node)].filter((s) => !ps.has(s));
    return { kind: 'fndef', name, params, node, deps, rhs, raw };
  } catch (err) {
    return { kind: 'error', message: friendlyError(err) };
  }
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

/** Index of the first top-level `where` keyword (outside brackets), or -1. */
function findWhere(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (
      depth === 0 &&
      c === 'w' &&
      s.startsWith('where', i) &&
      !/[A-Za-z0-9_]/.test(s[i - 1] ?? ' ') &&
      !/[A-Za-z0-9_]/.test(s[i + 5] ?? ' ')
    ) {
      return i;
    }
  }
  return -1;
}

/** Does this entry use local definitions (`… where a = …`)? */
export function hasWhere(raw: string): boolean {
  return findWhere(raw.trim()) > 0;
}

const WHERE_RESERVED = new Set([...RESERVED, 'x', 'y', 'r', 'theta', 'θ', 'where', 'for', 'step']);

/** Replace every standalone identifier `name` in `text` (not part of a longer
 * name, not a number's exponent like 1e5) with `(value)`. */
function substituteName(text: string, name: string, value: string): string {
  return text.replace(/[A-Za-z_]\w*/g, (m, at: number) => {
    if (m !== name) return m;
    if (/[0-9.]/.test(text[at - 1] ?? '') && /^e\d*$/.test(m)) return m;
    return `(${value})`;
  });
}

/**
 * Local definitions: `body where a = expr, b = expr` is `body` with each local
 * substituted (later locals may use earlier ones, and `for` loop variables). A
 * trailing `for …` clause may follow the definitions. Repeated uses are shared
 * at evaluation time (fastCompile CSE + hoisting), so a local is computed once.
 * Returns the expanded text, an error, or null when there's no `where`.
 */
export function expandWhere(trimmed: string): { text: string } | { error: string } | null {
  const at = findWhere(trimmed);
  if (at < 0) return null;
  const body = trimmed.slice(0, at).trim();
  let defsText = trimmed.slice(at + 5).trim();
  if (!body) return { error: 'Nothing before "where"' };
  // `body where a = … for k = 0..3`: the loop belongs to the body.
  let loop = '';
  const forAt = findFor(defsText);
  if (forAt >= 0) {
    loop = defsText.slice(forAt);
    defsText = defsText.slice(0, forAt).trim();
  }
  const clauses = splitTopChar(defsText, ',').map((c) => c.trim()).filter(Boolean);
  if (!clauses.length) return { error: 'Expected definitions after "where", like: where a = 2t' };
  const seen = new Map<string, string>();
  for (const clause of clauses) {
    const m = /^([A-Za-z]\w*)\s*=(?!=)\s*(.+)$/.exec(clause);
    if (!m) return { error: `Expected name = value after "where", got "${clause}"` };
    const [, name, valueRaw] = m;
    if (WHERE_RESERVED.has(name)) return { error: `A local can't be called ${name}` };
    if (seen.has(name)) return { error: `Local ${name} is defined twice` };
    let value = valueRaw.trim();
    for (const [n, v] of seen) value = substituteName(value, n, v);
    if (findWhere(value) >= 0) return { error: 'Nested "where" is not supported' };
    seen.set(name, value);
  }
  let text = body;
  // Substitute the last-defined first so earlier locals inside later ones (already
  // expanded above) aren't revisited.
  for (const [n, v] of [...seen].reverse()) text = substituteName(text, n, v);
  if (loop) {
    let l = loop;
    for (const [n, v] of [...seen].reverse()) l = substituteName(l, n, v);
    text = `${text} ${l}`;
  }
  return { text };
}

function parseEntryUncached(raw: string): Parsed {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  // Locals: `body where a = …` → body with the locals substituted (see expandWhere).
  const local = expandWhere(trimmed);
  if (local) {
    if ('error' in local) return { kind: 'error', message: local.error };
    const inner = parseEntry(local.text);
    return 'raw' in inner ? { ...inner, raw } : inner;
  }

  // Repeat: `body for k = 0..5` — split before anything else so the body can be
  // any repeatable kind (inequalities included).
  const forAt = findFor(trimmed);
  if (forAt > 0) return parseRepeat(trimmed, forAt, raw);

  const normalized = normalizeInput(trimmed);

  // Frame sequence: frames(index expression).
  const fm = /^frames\s*\((.*)\)$/.exec(normalized);
  if (fm) {
    try {
      const indexNode = mjParse(fm[1].trim() || '0');
      return { kind: 'frames', indexNode, deps: [...freeSymbols(indexNode)], raw };
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  // Point literals: (a,b), [(x,y),…], ((x,y),(x,y),…)
  if (looksLikePoints(normalized)) {
    try {
      const pts = parsePoints(normalized);
      // A single point whose coordinates use t is a parametric curve (x(t), y(t)).
      if (pts && pts.points.length === 1 && !pts.polyline && !pts.scattered) {
        const p = pts.points[0];
        if (p.tNode && p.yNode && (hasSymbol(p.tNode, 't') || hasSymbol(p.yNode, 't'))) {
          const deps = new Set([...freeSymbols(p.tNode), ...freeSymbols(p.yNode)]);
          return { kind: 'parametric', xNode: p.tNode, yNode: p.yNode, deps: [...deps], raw };
        }
      }
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

  // Inequalities: y < f(t), t²+y² ≤ 9, 1 < y < sin(t), a<f & b>g … → a shaded
  // region where every LHS−RHS constraint satisfies its operator vs 0.
  // Function definitions (and anything with a ternary `c ? a : b`) may contain
  // comparisons, so they're recognised before inequalities.
  const early = splitEquation(normalized);
  if (early && early[1]) {
    const fndef = parseFnDef(early[0], early[1], raw);
    if (fndef) return fndef;
  }
  const ineq = normalized.includes('?') ? null : parseInequality(normalized);
  if (ineq) {
    try {
      // Canonicalise x → t across the whole inequality when x is the independent.
      let anyX = false;
      let anyT = false;
      for (const c of ineq.conjuncts) {
        for (const op of c.operands) {
          try {
            const n = mjParse(op);
            if (hasSymbol(n, 'x')) anyX = true;
            if (hasSymbol(n, 't')) anyT = true;
          } catch {
            /* ignore unparseable operand here; the loop below will report it */
          }
        }
      }
      const conjuncts =
        anyX && !anyT
          ? ineq.conjuncts.map((c) => ({ operands: c.operands.map(rewriteXtoTStr), ops: c.ops }))
          : ineq.conjuncts;

      const parts: { node: MathNode; op: IneqOp }[] = [];
      const deps = new Set<string>();
      for (const { operands, ops } of conjuncts) {
        for (let i = 0; i < ops.length; i++) {
          const node = mjParse(`(${operands[i]}) - (${operands[i + 1]})`);
          parts.push({ node, op: ops[i] });
          // t, y are the axes; r, θ are the polar coordinates derived from them.
          for (const sym of freeSymbols(node)) {
            if (sym !== INDEP && sym !== 'y' && sym !== 'r' && sym !== 'θ' && sym !== 'theta') {
              deps.add(sym);
            }
          }
        }
      }
      const polar = parts.some(
        (p) => hasSymbol(p.node, 'r') || hasSymbol(p.node, 'θ') || hasSymbol(p.node, 'theta'),
      );
      return { kind: 'inequality', parts, conjuncts, polar, deps: [...deps], raw };
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  const split = splitEquation(normalized);

  // No '=' -> bare expression, function of t.
  if (!split) {
    try {
      let node = mjParse(normalized);
      if ([...freeSymbols(node)].some((s) => DERIV_TOKEN.test(s))) {
        return { kind: 'error', message: 'Write the ODE as an equation, e.g. y′ = …' };
      }
      if (xIsIndependent(node)) node = rewriteXtoT(node);
      const deps = [...freeSymbols(node)].filter((s) => s !== INDEP);
      return { kind: 'function', name: 'y', node, deps, raw };
    } catch (err) {
      return { kind: 'error', message: friendlyError(err) };
    }
  }

  const [lhs, rhs] = split;
  if (!rhs) return { kind: 'error', message: 'Missing right-hand side' };

  // Function definition: f(a, b) = …
  const fndef = parseFnDef(lhs, rhs, raw);
  if (fndef) return fndef;

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

  // x as the independent (e.g. y = x², x² + y² = 9): canonicalise x → t. Skipped
  // for ODEs above, where x may be a coupled dependent variable.
  if (xIsIndependent(combined)) {
    const l = rewriteXtoTStr(lhs);
    const r = rewriteXtoTStr(rhs);
    try {
      return parseRelation(l, r, mjParse(`(${l}) - (${r})`), raw);
    } catch {
      /* fall through to the original */
    }
  }

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
  // `name = expr` without y: a variable, derived value or named function of t.
  // Decided without symbolic differentiation (which can't handle e.g. ternaries).
  if (IDENT.test(lhs) && lhs !== INDEP && lhs !== 'y') {
    try {
      const node = mjParse(rhs);
      if (!hasSymbol(node, 'y')) return namedValue(lhs, rhs, node, raw);
    } catch {
      /* fall through */
    }
  }
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
        return namedValue(lhs, rhs, mjParse(rhs), raw);
      }
      // Relation in t only (t = 0, t² = 1, …) -> implicit.
    }
  } catch {
    /* fall through to implicit */
  }
  const deps = [...freeSymbols(F)].filter((s) => s !== INDEP && s !== 'y');
  return { kind: 'implicit', node: F, deps, lhs, rhs, raw };
}

/** `name = expr` (no y): a constant → variable (slider); otherwise a named
 * expression — a function of t when it uses t, else a derived value. */
function namedValue(lhs: string, rhs: string, node: MathNode, raw: string): Parsed {
  const deps = [...freeSymbols(node)];
  const usesT = hasSymbol(node, INDEP);
  // Only evaluate calls to plain mathjs functions here (links are untrusted
  // input; scripting helpers need the scope, so those become derived values).
  const safe = [...calledFunctions(node)].every((f) => KNOWN_FUNCTIONS.has(f) && !HELPERS_SET.has(f));
  if (safe && !usesT && deps.length === 0) {
    let value: unknown;
    try {
      value = (node as unknown as { evaluate: () => unknown }).evaluate();
    } catch {
      value = NaN;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { kind: 'variable', name: lhs, value, raw };
    }
  }
  return { kind: 'function', name: lhs, node, deps, raw, lhs, rhs };
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s*\(char \d+\)$/, '');
}
