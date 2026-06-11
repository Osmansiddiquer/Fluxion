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

function texOf(src: string): string {
  try {
    return postTex(mjParse(src).toTex());
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
      return `y = ${postTex(parsed.node.toTex())}`;
    case 'ode':
    case 'implicit':
      return `${texOf(parsed.lhs)} = ${texOf(parsed.rhs)}`;
    case 'polar':
      return `r = ${postTex(parsed.rNode.toTex())}`;
    default:
      return null;
  }
}
