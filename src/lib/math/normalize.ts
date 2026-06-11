import { FUNCTION_SYNONYMS, UNICODE_MAP, INVERSE_BASE, KNOWN_FUNCTIONS } from './builtins';
import { greekGlyphToWord } from './greek';

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

/** Convert Leibniz + prime notation into internal `D{k}_name` symbols. */
export function normalizeDerivatives(input: string): string {
  let s = input;
  s = s.replace(/d\s*\^?\s*2\s*([A-Za-z]\w*)\s*\/\s*d\s*t\s*\^?\s*2/g, "$1''");
  s = s.replace(/d\s*([A-Za-z]\w*)\s*\/\s*d\s*t/g, "$1'");
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
  s = applySynonyms(s);
  s = rewritePowFunc(s);
  s = normalizeDerivatives(s);
  return s;
}
