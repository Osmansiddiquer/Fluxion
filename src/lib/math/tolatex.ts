import { parse as mjParse } from 'mathjs';
import { hasWhere, type CondSpec, type Parsed } from './parse';
import { greekWordToTex } from './greek';
import { fmtSig } from '../format';

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
  // mathjs wraps some symbols (e.g. `t`, which it reads as the tonne unit) in
  // \mathrm{}. Re-wrap in braces so a preceding command like \cdot can't merge
  // into it (\cdot\mathrm{t} -> \cdot{t}, never \cdott).
  s = s.replace(/\\mathrm\{([A-Za-z][A-Za-z0-9]*)\}/g, '{$1}');
  s = s.replace(
    /D(\d+)\\?_\{?([A-Za-z][A-Za-z0-9]*)\}?/g,
    (_m, k: string, name: string) => name + "'".repeat(Number(k)),
  );
  return s;
}

// `implicit: 'hide'` drops the · for implicit products the user didn't type — so
// 2t shows as "2t", not "2·t", while an explicit pi*t keeps its ·.
const TEX_OPTS = { implicit: 'hide' } as const;

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
      const name = greekWordToTex(c.depVar) + "'".repeat(c.k);
      return `${name}\\left(${postTex(c.at.toTex(TEX_OPTS))}\\right) = ${postTex(c.value.toTex(TEX_OPTS))}`;
    })
    .join(',\\ ');
}

/** An ODE's left side; `dy/dx` rows keep their Leibniz form (dy/dx, d²y/dx²). */
function odeLhsTex(lhs: string, depVar: string, order: number, indep?: 'x'): string {
  const bare = lhs.replace(/^\((.*)\)$/, '$1').trim();
  if (indep === 'x' && bare === `D${order}_${depVar}`) {
    const v = greekWordToTex(depVar);
    return order === 1 ? `\\frac{d${v}}{dx}` : `\\frac{d^${order}${v}}{dx^${order}}`;
  }
  return texOf(lhs);
}

/** Build a KaTeX-ready LaTeX string for an entry, or null if not renderable.
 *  `varValue` overrides a variable's displayed value (the live slider value). */
export function entryToLatex(parsed: Parsed, varValue?: number): string | null {
  // Locals (`… where a = …`) are shown as typed: the parse is of the expanded text.
  if ('raw' in parsed && typeof parsed.raw === 'string' && hasWhere(parsed.raw)) return null;
  switch (parsed.kind) {
    case 'variable':
      return `${greekWordToTex(parsed.name)} = ${fmtNum(varValue ?? parsed.value)}`;
    case 'function':
      if (parsed.lhs != null && parsed.rhs != null) {
        return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
      }
      return `y = ${postTex(parsed.node.toTex(TEX_OPTS))}`;
    case 'ode': {
      const conds = parsed.conds?.length ? `,\\ ${condsTex(parsed.conds)}` : '';
      return `${odeLhsTex(parsed.lhs, parsed.depVar, parsed.order, parsed.indep)} = ${texOf(parsed.rhs)}${conds}`;
    }
    case 'condition':
      return condsTex(parsed.conds);
    case 'implicit':
      return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
    case 'polar':
      return `r = ${postTex(parsed.rNode.toTex(TEX_OPTS))}`;
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
      return `\\left(${postTex(parsed.xNode.toTex(TEX_OPTS))},\\ ${postTex(
        parsed.yNode.toTex(TEX_OPTS),
      )}\\right)`;
    case 'fndef':
      // Ternaries render as a cases environment that can't round-trip through the
      // editor — show those definitions as typed.
      if (/[?[]/.test(parsed.rhs)) return null;
      return `${greekWordToTex(parsed.name)}\\left(${parsed.params
        .map(greekWordToTex)
        .join(',')}\\right) = ${texOf(parsed.rhs)}`;
    case 'repeat': {
      const body = entryToLatex(parsed.body);
      if (body == null) return null;
      const loops = parsed.loops.map((l) => `${greekWordToTex(l.name)}=${l.text}`).join(',\\ ');
      return `${body}\\ \\operatorname{for}\\ ${loops}`;
    }
    case 'frames':
      return `\\operatorname{frames}\\left(${postTex(parsed.indexNode.toTex(TEX_OPTS))}\\right)`;
    default:
      return null;
  }
}
