import { parse as mjParse } from 'mathjs';
import type { Parsed } from './parse';
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

/** Build a KaTeX-ready LaTeX string for an entry, or null if not renderable.
 *  `varValue` overrides a variable's displayed value (the live slider value). */
export function entryToLatex(parsed: Parsed, varValue?: number): string | null {
  switch (parsed.kind) {
    case 'variable':
      return `${greekWordToTex(parsed.name)} = ${fmtNum(varValue ?? parsed.value)}`;
    case 'function':
      if (parsed.lhs != null && parsed.rhs != null) {
        return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
      }
      return `y = ${postTex(parsed.node.toTex(TEX_OPTS))}`;
    case 'ode':
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
    default:
      return null;
  }
}
