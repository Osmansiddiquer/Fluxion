// Convert the LaTeX produced by the MathLive editor into the plain infix syntax
// our parser (mathjs, see normalize.ts) understands. Handles the subset MathLive
// emits for typical input: fractions, roots, powers, primes, operators, Greek and
// function commands. Anything unrecognised degrades to backslash-stripped text.

/** Index just past the `}` matching the `{` at `open`. */
function braceEnd(s: string, open: number): { content: string; end: number } {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return { content: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return { content: s.slice(open + 1), end: s.length };
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && s[i] === ' ') i++;
  return i;
}

/** Replace every \frac{A}{B} (incl. nested) with (A)/(B). */
function replaceFrac(s: string): string {
  let out = s.replace(/\\dfrac|\\tfrac/g, '\\frac');
  let i = out.indexOf('\\frac');
  let guard = 0;
  while (i !== -1 && guard++ < 500) {
    let p = skipSpace(out, i + 5);
    if (out[p] !== '{') break;
    const a = braceEnd(out, p);
    let q = skipSpace(out, a.end);
    if (out[q] !== '{') break;
    const b = braceEnd(out, q);
    // Fully parenthesise so adjacent fractions / implicit multiplication parse
    // correctly: ((A)/(B)) — not (A)/(B), which mathjs would chain as A/(B·next).
    out = out.slice(0, i) + `((${a.content})/(${b.content}))` + out.slice(b.end);
    i = out.indexOf('\\frac');
  }
  return out;
}

/** Replace \sqrt{A} -> sqrt(A) and \sqrt[n]{A} -> nthRoot(A,n). */
function replaceSqrt(s: string): string {
  let out = s;
  let i = out.indexOf('\\sqrt');
  let guard = 0;
  while (i !== -1 && guard++ < 500) {
    let p = skipSpace(out, i + 5);
    let n: string | null = null;
    if (out[p] === '[') {
      const close = out.indexOf(']', p);
      if (close !== -1) {
        n = out.slice(p + 1, close);
        p = skipSpace(out, close + 1);
      }
    }
    if (out[p] !== '{') break;
    const a = braceEnd(out, p);
    const repl = n != null ? `nthRoot(${a.content},${n})` : `sqrt(${a.content})`;
    out = out.slice(0, i) + repl + out.slice(a.end);
    i = out.indexOf('\\sqrt');
  }
  return out;
}

/** Index just past the `)` matching the `(` at `open`, or -1. */
function parenEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Rewrite log with a subscript base — log_b(x) — to mathjs's log(x, b). The base
 * may be an identifier/number or a (possibly nested) parenthesised expression. */
function replaceLogBase(s: string): string {
  let out = s;
  let guard = 0;
  let idx: number;
  while ((idx = out.search(/\blog_/)) !== -1 && guard++ < 200) {
    let p = idx + 4; // just past "log_"
    let base: string;
    if (out[p] === '(') {
      const e = parenEnd(out, p);
      if (e === -1) break;
      base = out.slice(p + 1, e); // strip the outer parens of the base
      p = e + 1;
    } else {
      const m = /^[A-Za-z0-9.]+/.exec(out.slice(p));
      if (!m) break;
      base = m[0];
      p += m[0].length;
    }
    p = skipSpace(out, p);
    if (out[p] !== '(') break; // no parenthesised argument
    const e = parenEnd(out, p);
    if (e === -1) break;
    const arg = out.slice(p + 1, e);
    out = out.slice(0, idx) + `log(${arg}, ${base})` + out.slice(e + 1);
  }
  return out;
}

/** Replace \operatorname{name} and \mathrm{name} with name. */
function replaceWrapped(s: string, cmd: string): string {
  let out = s;
  let i = out.indexOf(cmd);
  let guard = 0;
  while (i !== -1 && guard++ < 500) {
    const p = skipSpace(out, i + cmd.length);
    if (out[p] !== '{') break;
    const a = braceEnd(out, p);
    out = out.slice(0, i) + a.content + out.slice(a.end);
    i = out.indexOf(cmd);
  }
  return out;
}

export function latexToText(latex: string): string {
  let s = latex;

  // Editor scaffolding.
  s = s.replace(/\\placeholder\{[^}]*\}/g, '');
  s = s.replace(/\\(left|right|mleft|mright)(?=[([|{.)\]}])?/g, '');
  // Named delimiters MathLive may emit for [ ] etc.
  s = s.replace(/\\lbrack/g, '[').replace(/\\rbrack/g, ']');
  s = s.replace(/\\lbrace/g, '{').replace(/\\rbrace/g, '}');
  s = s.replace(/\\langle/g, '(').replace(/\\rangle/g, ')');
  s = s.replace(/\\,|\\;|\\:|\\!|\\>|\\ /g, ' ');
  s = s.replace(/\\quad|\\qquad/g, ' ');

  // Primes (derivatives) come in many shapes; normalise everything to bare ' .
  s = s.replace(/[′]/g, "'"); // ′
  s = s.replace(/[″]/g, "''"); // ″
  s = s.replace(/[‴]/g, "'''"); // ‴
  s = s.replace(/\\(?:doubleprime|dprime)/g, "''");
  s = s.replace(/\\prime/g, "'");
  // Collapse superscripted primes: x^{''} or x^{'} or x^' -> x'' / x'
  s = s.replace(/\^\s*\{\s*('+)\s*\}/g, '$1');
  s = s.replace(/\^\s*'/g, "'");

  s = replaceWrapped(s, '\\operatorname');
  s = replaceWrapped(s, '\\mathrm');
  s = replaceWrapped(s, '\\mathit');
  s = replaceFrac(s);
  s = replaceSqrt(s);

  // Inequalities and conjunction (& joins region constraints).
  s = s.replace(/\\leq/g, '<=').replace(/\\le(?![a-zA-Z])/g, '<=');
  s = s.replace(/\\geq/g, '>=').replace(/\\ge(?![a-zA-Z])/g, '>=');
  s = s.replace(/\\lt/g, '<').replace(/\\gt/g, '>');
  s = s.replace(/\\land|\\wedge|\\&/g, '&');

  // Operators.
  s = s.replace(/\\cdot|\\times|\\ast/g, '*');
  s = s.replace(/\\div/g, '/');
  s = s.replace(/\\pm/g, '+');
  s = s.replace(/\\exponentialE/g, 'e');
  s = s.replace(/\\pi(?![a-zA-Z])/g, 'pi');

  // Strip backslash from remaining commands (functions, Greek, etc.).
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');

  // Subscripts: x_{1} -> x_1 (keep simple identifier subscripts).
  s = s.replace(/_\{([A-Za-z0-9]+)\}/g, '_$1');

  // Remaining braces (exponent/grouping) become parentheses.
  s = s.replace(/\{/g, '(').replace(/\}/g, ')');

  // log_b(x) -> log(x, b)  (after braces became parens so a base like x+1 works).
  s = replaceLogBase(s);

  // Tidy.
  s = s.replace(/\\/g, '').replace(/\s+/g, ' ').trim();
  return s;
}
