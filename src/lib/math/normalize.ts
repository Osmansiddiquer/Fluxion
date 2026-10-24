import { FUNCTION_SYNONYMS, UNICODE_MAP, INVERSE_BASE, KNOWN_FUNCTIONS } from './builtins';
import { greekGlyphToWord } from './greek';
import { desugarBraces } from './piecewise';
import { rewriteCoords } from './coords';

/** Index of the `)` matching the `(` at `open`, or -1 if unbalanced. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Rewrite `fn^k(arg)`:
 *   - base trig with k = -1  -> inverse function, e.g. sin^-1(x) -> asin(x)
 *   - any known fn with k    -> power,            e.g. sin^2(x)  -> (sin(x))^2
 * Only fires for known function names so `e^2(x)` is left untouched. Recurses
 * into the argument so nested calls are handled.
 */
function rewritePowFunc(s: string): string {
  const re = /([A-Za-z]\w*)\s*\^\s*(-?\d+)\s*\(/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[1];
    const exp = parseInt(m[2], 10);
    if (!KNOWN_FUNCTIONS.has(name)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchParen(s, open);
    if (close < 0) continue;
    const arg = rewritePowFunc(s.slice(open + 1, close));
    out += s.slice(last, m.index);
    if (exp === -1 && INVERSE_BASE.has(name)) {
      out += `a${name}(${arg})`;
    } else {
      out += `(${name}(${arg}))^(${exp})`;
    }
    last = close + 1;
    re.lastIndex = close + 1;
  }
  out += s.slice(last);
  return out;
}

function applySynonyms(s: string): string {
  // Replace `name(` where name is a known synonym.
  return s.replace(/([A-Za-z]\w*)(\s*\()/g, (full, name: string, tail: string) => {
    const syn = FUNCTION_SYNONYMS[name];
    return syn ? syn + tail : full;
  });
}

function applyUnicode(s: string): string {
  let out = s;
  for (const [re, rep] of UNICODE_MAP) out = out.replace(re, rep);
  return out;
}

// `d` must start a token (not the end of `and`, `nd2`, …).
const LEIBNIZ_PAREN_K =
  /(?<![A-Za-z_])\(\s*d\s*\^?\s*\{?\s*(\d)\s*\}?\s*([A-Za-z]\w*)\s*\)\s*\/\s*\(\s*d\s*[tx]\s*\^?\s*\{?\s*\1\s*\}?\s*\)/g;
const LEIBNIZ_PAREN_1 = /(?<![A-Za-z_])\(\s*d\s*([A-Za-z]\w*)\s*\)\s*\/\s*\(\s*d\s*[tx]\s*\)/g;
const LEIBNIZ_K = /(?<![A-Za-z_])d\s*\^?\s*\{?\s*(\d)\s*\}?\s*([A-Za-z]\w*)\s*\/\s*d\s*[tx]\s*\^?\s*\{?\s*\1\s*\}?/g;
const LEIBNIZ_1 = /(?<![A-Za-z_])d\s*([A-Za-z]\w*)\s*\/\s*d\s*[tx](?![A-Za-z0-9_])/g;
const LEIBNIZ_X = /(?<![A-Za-z_])\(?\s*d\s*(?:\^?\s*\{?\s*\d\s*\}?\s*)?[A-Za-z]\w*\s*\)?\s*\/\s*\(?\s*d\s*x(?![A-Za-z0-9_])/;

/** Does the text use Leibniz notation in x (dy/dx, d²y/dx²)? Then x is the
 * independent variable of that ODE (like a function y = f(x)). */
export function usesLeibnizX(input: string): boolean {
  return LEIBNIZ_X.test(applyUnicode(greekGlyphToWord(input)));
}

/** Convert Leibniz + prime notation into internal `D{k}_name` symbols. */
export function normalizeDerivatives(input: string): string {
  let s = input;
  // Leibniz in t or x (x then becomes the independent variable, see usesLeibnizX):
  // dy/dt, d^2y/dx^2, and the parenthesised LaTeX forms ((dy)/(dx)), ((d^{2}y)/(dx^{2})).
  s = s.replace(LEIBNIZ_PAREN_K, (_m, k: string, name: string) => name + "'".repeat(Number(k)));
  s = s.replace(LEIBNIZ_PAREN_1, "$1'");
  s = s.replace(LEIBNIZ_K, (_m, k: string, name: string) => name + "'".repeat(Number(k)));
  s = s.replace(LEIBNIZ_1, "$1'");
  s = s.replace(
    /([A-Za-z]\w*)('+)/g,
    (_m, name: string, primes: string) => `D${primes.length}_${name}`,
  );
  return s;
}

/**
 * Full normalisation pipeline applied before mathjs parsing: Greek glyphs and
 * Unicode operators to ASCII, friendly function synonyms, inverse/power trig,
 * then derivative notation.
 */
export function normalizeInput(raw: string): string {
  let s = raw;
  s = greekGlyphToWord(s);
  s = applyUnicode(s);
  // Point coordinates A.x / A.y → the plain symbols A__x / A__y (see coords.ts).
  s = rewriteCoords(s);
  s = applySynonyms(s);
  s = rewritePowFunc(s);
  s = normalizeDerivatives(s);
  // Desmos braces (piecewise / conditions) → nested ternaries (see piecewise.ts).
  s = desugarBraces(s);
  return s;
}
