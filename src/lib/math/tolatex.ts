import { parse as mjParse, type MathNode } from 'mathjs';
import { hasWhere, isNaNNode, type CondSpec, type Parsed } from './parse';
import { greekWordToTex, nameToTex } from './greek';
import { fmtSig } from '../format';
import { splitCoord } from './coords';

function fmtNum(n: number): string {
  return fmtSig(n);
}

/**
 * Tidy mathjs LaTeX. mathjs already maps Greek names (omega -> \omega), so we only
 * drop \mathrm wrappers (for upright single letters like t) and turn derivative
 * tokens D{k}_name into primes.
 */
function postTex(tex: string): string {
  let s = tex;
  // The impulse delta(t − a) reads as δ(t − a) (latexToText maps \delta back).
  s = s.replace(/\\mathrm\{delta\}(?=\\left\()/g, '\\delta');
  // Step functions keep their call shape (H(t − 1), not H·(t − 1), on the way back).
  s = s.replace(/\\mathrm\{(H|u|heaviside)\}(?=\\left\()/g, '\\operatorname{$1}');
  // Call heads keep their call shape on the way back through the editor (a
  // braced {g} would read as g·(…)): an ODE solution y(T) or its derivative
  // y'(T) (the function D1_y), a user function g(2), a helper lerp(…).
  s = s.replace(
    /\\mathrm\{(?:D(\d+)_)?([A-Za-z][A-Za-z0-9]*)\}(?=\\left\()/g,
    (_m, k: string | undefined, name: string) => {
      const head = greekWordToTex(name);
      const primes = "'".repeat(Number(k ?? 0));
      return head.length === 1 || head.startsWith('\\') || primes
        ? `\\mathit{${head}${primes}}`
        : `\\operatorname{${name}}`;
    },
  );
  // mathjs wraps some symbols (e.g. `t`, which it reads as the tonne unit) in
  // \mathrm{}. Re-wrap in braces so a preceding command like \cdot can't merge
  // into it (\cdot\mathrm{t} -> \cdot{t}, never \cdott).
  s = s.replace(/\\mathrm\{([A-Za-z][A-Za-z0-9]*)\}/g, '{$1}');
  s = s.replace(
    /D(\d+)\\?_\{?([A-Za-z][A-Za-z0-9]*)(?:\\?_([A-Za-z0-9]+))?\}?/g,
    (_m, k: string, name: string, sub: string | undefined) =>
      nameToTex(sub ? `${name}_${sub}` : name) + "'".repeat(Number(k)),
  );
  // Subscripted names, which mathjs escapes (omega\_0): typeset ω₀, a₁.
  s = s.replace(/(?<![\\A-Za-z0-9])([A-Za-z][A-Za-z0-9]*)\\_([A-Za-z0-9]+)/g, (_m, name: string, sub: string) =>
    nameToTex(`${name}_${sub}`),
  );
  return s;
}

// `implicit: 'hide'` drops the · for implicit products the user didn't type — so
// 2t shows as "2t", not "2·t", while an explicit pi*t keeps its ·.
// Ternaries / piecewise values render Desmos-style as \left\{c: a,\ b\right\}
// (a cases environment can't round-trip through the editor); `\{c\}` for the
// bare condition c ? 1 : NaN.
type TexOpts = { implicit: 'hide'; handler: (node: MathNode, options: object) => string | undefined };
const TEX_OPTS: TexOpts = { implicit: 'hide', handler: texHandler };

function unparen(n: MathNode): MathNode {
  let m = n as MathNode & { type: string; content?: MathNode };
  while (m.type === 'ParenthesisNode' && m.content) m = m.content as typeof m;
  return m;
}

function isDivide(n: MathNode): boolean {
  const m = n as unknown as { type: string; fn?: string; args?: MathNode[] };
  return m.type === 'OperatorNode' && m.fn === 'divide' && m.args?.length === 2;
}

function isOne(n: MathNode): boolean {
  const m = unparen(n) as unknown as { type: string; value?: unknown };
  return m.type === 'ConstantNode' && m.value === 1;
}

type CondNode = { type: string; condition: MathNode; trueExpr: MathNode; falseExpr: MathNode };

function texHandler(node: MathNode, options: object): string | undefined {
  const type = (node as { type: string }).type;
  // A point coordinate A__x (typed A.x) shows as A.x.
  if (type === 'SymbolNode') {
    const c = splitCoord((node as unknown as { name: string }).name);
    return c ? `\\mathit{${nameToTex(c.point)}}.${c.prop}` : undefined;
  }
  // The braces already delimit a piecewise value: no extra parentheses.
  if (type === 'ParenthesisNode' && (unparen(node) as { type: string }).type === 'ConditionalNode') {
    return unparen(node).toTex(options);
  }
  // (b) shows as b: brackets around a lone name add nothing.
  if (type === 'ParenthesisNode' && (unparen(node) as { type: string }).type === 'SymbolNode') {
    return unparen(node).toTex(options);
  }
  // A fraction delimits itself: no brackets around it or inside it. (Typing
  // 1/(x+1) gives ((1)/((x+1))), which showed as (\frac{(1)}{((x+1))}).)
  if (type === 'ParenthesisNode' && isDivide(unparen(node))) return unparen(node).toTex(options);
  if (type === 'OperatorNode' && isDivide(node)) {
    const [a, b] = (node as unknown as { args: MathNode[] }).args;
    return `\\frac{${unparen(a).toTex(options)}}{${unparen(b).toTex(options)}}`;
  }
  // A raised exponent is grouped already: e^{-x^2}, not e^{(-x^2)}.
  if (type === 'OperatorNode' && (node as unknown as { fn: string }).fn === 'pow') {
    const [b, x] = (node as unknown as { args: MathNode[] }).args;
    if ((x as { type: string }).type !== 'ParenthesisNode') return undefined;
    const base = unparen(b);
    const simple = ['SymbolNode', 'ConstantNode', 'FunctionNode'].includes((base as { type: string }).type);
    const baseTex = simple ? base.toTex(options) : `\\left(${base.toTex(options)}\\right)`;
    return `{${baseTex}}^{${unparen(x).toTex(options)}}`;
  }
  // A list shows as typed, [1, 2, 3] — not a column vector (which the editor
  // can't read back).
  if (type === 'ArrayNode') {
    const items = (node as unknown as { items: MathNode[] }).items;
    if (items.every((i) => (i as { type: string }).type !== 'ArrayNode')) {
      return `\\left[${items.map((i) => i.toTex(options)).join(',')}\\right]`;
    }
  }
  if (type !== 'ConditionalNode') return undefined;
  const tex = (n: MathNode) => unparen(n).toTex(options);
  const first = node as unknown as CondNode;
  if (isOne(first.trueExpr) && isNaNNode(first.falseExpr)) return `\\left\\{${tex(first.condition)}\\right\\}`;
  const pieces: string[] = [];
  let cur: MathNode = node;
  for (;;) {
    const c = unparen(cur) as unknown as CondNode;
    if (c.type !== 'ConditionalNode') {
      if (!isNaNNode(cur)) pieces.push(tex(cur));
      break;
    }
    // \colon: tight before, a space after (`:` would space like a relation).
    pieces.push(`${tex(c.condition)}\\colon\\, ${tex(c.trueExpr)}`);
    cur = c.falseExpr;
  }
  return `\\left\\{${pieces.join(',\\ ')}\\right\\}`;
}

/** Trailing restrictions as braces: y = x^2 \{0 < x < 2\}. */
function restrictionsTex(parsed: Parsed): string {
  const rs = 'restrictions' in parsed ? parsed.restrictions : undefined;
  if (!rs?.length) return '';
  return rs.map((r) => `\\left\\{${postTex(unparen(r.node).toTex(TEX_OPTS))}\\right\\}`).join('');
}

/** The expression under k restriction guards (c ? (… node …) : NaN). */
function peel(node: MathNode, k: number): MathNode {
  let n = node;
  for (let i = 0; i < k; i++) {
    const c = unparen(n) as unknown as CondNode;
    if (c.type !== 'ConditionalNode') break;
    n = c.trueExpr;
  }
  return n;
}

const nRestr = (parsed: Parsed) => ('restrictions' in parsed ? parsed.restrictions?.length ?? 0 : 0);

function texOf(src: string): string {
  try {
    return postTex(mjParse(src).toTex(TEX_OPTS));
  } catch {
    return src;
  }
}

/** y′(0) = 1, y(π) = 0 */
function condsTex(conds: CondSpec[]): string {
  return conds
    .map((c) => {
      const name = nameToTex(c.depVar) + "'".repeat(c.k);
      return `${name}\\left(${postTex(c.at.toTex(TEX_OPTS))}\\right) = ${postTex(c.value.toTex(TEX_OPTS))}`;
    })
    .join(',\\ ');
}

/** An ODE's left side; `dy/dx` rows keep their Leibniz form (dy/dx, d²y/dx²). */
function odeLhsTex(lhs: string, depVar: string, order: number, indep?: 'x'): string {
  const bare = lhs.replace(/^\((.*)\)$/, '$1').trim();
  if (indep === 'x' && bare === `D${order}_${depVar}`) {
    const v = nameToTex(depVar);
    return order === 1 ? `\\frac{d${v}}{dx}` : `\\frac{d^${order}${v}}{dx^${order}}`;
  }
  return texOf(lhs);
}

/** Build a KaTeX-ready LaTeX string for an entry, or null if not renderable.
 *  `varValue` overrides a variable's displayed value (the live slider value). */
export function entryToLatex(parsed: Parsed, varValue?: number): string | null {
  const base = baseLatex(parsed, varValue);
  if (base == null) return null;
  const out = base + restrictionsTex(parsed);
  // x as the independent variable is computed as t, but shows as the x that was
  // typed (otherwise the next edit silently turned the user's x into t).
  return typedX(parsed) ? out.replace(/\{t\}/g, '{x}') : out;
}

function typedX(parsed: Parsed): boolean {
  if (!('raw' in parsed) || typeof parsed.raw !== 'string') return false;
  const ids = new Set(parsed.raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  return ids.has('x') && !ids.has('t');
}

function baseLatex(parsed: Parsed, varValue?: number): string | null {
  // Locals (`… where a = …`) are shown as typed: the parse is of the expanded text.
  if ('raw' in parsed && typeof parsed.raw === 'string' && hasWhere(parsed.raw)) return null;
  switch (parsed.kind) {
    case 'variable':
      return `${nameToTex(parsed.name)} = ${fmtNum(varValue ?? parsed.value)}`;
    case 'function':
      if (parsed.lhs != null && parsed.rhs != null) {
        return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
      }
      return `y = ${postTex(peel(parsed.node, nRestr(parsed)).toTex(TEX_OPTS))}`;
    case 'ode': {
      const conds = parsed.conds?.length ? `,\\ ${condsTex(parsed.conds)}` : '';
      return `${odeLhsTex(parsed.lhs, parsed.depVar, parsed.order, parsed.indep)} = ${texOf(parsed.rhs)}${conds}`;
    }
    case 'condition':
      return condsTex(parsed.conds);
    case 'implicit':
      return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
    case 'polar':
      return `r = ${postTex(peel(parsed.rNode, nRestr(parsed)).toTex(TEX_OPTS))}`;
    case 'inequality': {
      const OP = { '<': '<', '>': '>', '<=': '\\le ', '>=': '\\ge ' } as const;
      return parsed.conjuncts
        .map((c) => {
          let s = texOf(c.operands[0]);
          for (let i = 0; i < c.ops.length; i++) s += ` ${OP[c.ops[i]]} ${texOf(c.operands[i + 1])}`;
          return s;
        })
        .join(' \\wedge ');
    }
    case 'parametric':
      return `\\left(${postTex(peel(parsed.xNode, nRestr(parsed)).toTex(TEX_OPTS))},\\ ${postTex(
        peel(parsed.yNode, nRestr(parsed)).toTex(TEX_OPTS),
      )}\\right)`;
    case 'fndef':
      // Indexing / arrays don't round-trip through the editor: shown as typed.
      if (/\[/.test(parsed.rhs)) return null;
      return `${nameToTex(parsed.name)}\\left(${parsed.params
        .map(nameToTex)
        .join(',')}\\right) = ${texOf(parsed.rhs)}`;
    case 'repeat': {
      const body = entryToLatex(parsed.body);
      if (body == null) return null;
      const loops = parsed.loops.map((l) => `${nameToTex(l.name)}=${l.text}`).join(',\\ ');
      return `${body}\\ \\operatorname{for}\\ ${loops}`;
    }
    case 'frames':
      return `\\operatorname{frames}\\left(${postTex(parsed.indexNode.toTex(TEX_OPTS))}\\right)`;
    default:
      return null;
  }
}
