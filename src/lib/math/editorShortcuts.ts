// What the MathLive editor turns typed words into. Everything here must read
// back (latexToText) as the same text the user typed.
import { FUNCTION_SUGGESTIONS } from './builtins';
import { GREEK_WORDS, greekWordToTex } from './greek';

/** Function names MathLive typesets as upright operators (\sin, \ln, …). */
const OPERATOR_NAMES = [
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'coth',
  'arcsin', 'arccos', 'arctan',
  'ln', 'log', 'exp', 'min', 'max', 'gcd',
];
const OPERATORS = new Set(OPERATOR_NAMES);

/**
 * Inline shortcuts kept from MathLive's defaults: Greek words, operator names,
 * `sqrt`/`cbrt`, primes and ≤ ≥ ≠. The rest rewrite plain names into notation that changes their
 * meaning or can't be parsed back — `mod` → \bmod, `log` → \log_{□}, `floor` →
 * ⌊□⌋, `nthroot` → a radical with the arguments in the index, `dx`/`dy`/`dt` →
 * a differential d (breaking dy/dx), `in` → ∈, `ii` → i, units (`cm`, `kg`) and
 * set/logic symbols — so they're dropped.
 */
export function editorShortcuts(defaults: Record<string, unknown>): Record<string, unknown> {
  const keep = new Set([
    ...GREEK_WORDS,
    ...OPERATOR_NAMES,
    'sqrt',
    'cbrt',
    // Symbols that read back unchanged: primes, ≤ ≥ ≠, the · of *.
    "''",
    "'''",
    "''''",
    '<=',
    '>=',
    '!=',
    '\u2264',
    '\u2265',
    '\u2260',
    '*',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(defaults)) if (keep.has(k)) out[k] = v;
  for (const w of GREEK_WORDS) {
    const tex = greekWordToTex(w);
    if (!(w in out) && tex.startsWith('\\')) out[w] = tex;
  }
  // A plain log (natural): log_2(x) is typed with `_`, as everywhere else.
  out.log = '\\log';
  return out;
}

/** The LaTeX to insert when an autocomplete suggestion is accepted. */
export function suggestionLatex(name: string): string {
  if (OPERATORS.has(name)) return `\\${name}`;
  if (name === 'sqrt') return '\\sqrt{#?}';
  if (name === 'cbrt') return '\\sqrt[3]{#?}';
  const greek = greekWordToTex(name);
  if (greek !== name && greek.startsWith('\\')) return greek;
  if (FUNCTION_SUGGESTIONS.includes(name)) return `\\operatorname{${name}}`;
  return name;
}
