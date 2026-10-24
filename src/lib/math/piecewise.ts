/**
 * Desmos-style braces, as plain text rewrites in front of mathjs.
 *
 *  - Piecewise: `{x < 0: -x, x < 2: x^2, 5}` takes the first piece whose
 *    condition holds; the trailing bare value is the else branch, and with no
 *    else the value is undefined (NaN, so nothing is drawn there). It becomes a
 *    nested ternary `((x < 0) ? (-x) : ((x < 2) ? (x^2) : (5)))` — ordinary
 *    mathjs ConditionalNodes, so the evaluator, the KNOWN_FUNCTIONS guards and
 *    the caches see nothing new.
 *  - A bare condition `{x > 0}` is 1 where it holds and undefined elsewhere.
 *  - Braces written right after an operand multiply it (`x^2 {x > 0}`), which is
 *    a restriction. Trailing braces on a whole row are split off first by
 *    `splitRestrictions` so each kind can apply them precisely (parse.ts).
 *
 * Conditions take <, <=, >, >=, = (equality), != , chains (0 < x < 2) and
 * and / or (& / && and || work too).
 */

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

const OPEN = '([{';
const CLOSE = ')]}';

/** Split on `sep` at the top level (outside (), [], {}). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && c === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the top-level `:` separating a piece's condition from its value
 * (a `:` belonging to a ternary `c ? a : b` in the condition is skipped). */
function pieceColon(s: string): number {
  let depth = 0;
  let pending = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (depth === 0 && c === '?') pending++;
    else if (depth === 0 && c === ':') {
      if (pending === 0) return i;
      pending--;
    }
  }
  return -1;
}

/** Does the text end with an operand (not an operator, `=`, `(`, `,`, …)? */
function endsWithOperand(s: string): boolean {
  return !/[=+\-*/^(\[{,:?<>&|!~≤≥]$/.test(s);
}

const COMPARISON = /[<>=]|!=|\band\b|\bor\b|\bnot\b|\btrue\b|\bfalse\b/;

/** Does this text look like a condition (it compares something)? */
export function isConditionText(s: string): boolean {
  return COMPARISON.test(s);
}

/** Condition text → mathjs syntax: lone `=` → `==`, `&`/`&&` → and, `|`/`||` → or. */
export function conditionToMath(s: string): string {
  let out = s.replace(/≠/g, '!=');
  out = out.replace(/&&?/g, ' and ').replace(/\|\|/g, ' or ');
  out = out.replace(/([^<>=!])=(?!=)/g, '$1==');
  return out.replace(/\s+/g, ' ').trim();
}

type Result = { text: string; pieces: number } | { error: string };

/** The ternary text for the inside of one brace group. */
function pieceText(inner: string): Result {
  const parts = splitTop(inner, ',').map((p) => p.trim());
  if (parts.length === 1 && !parts[0]) return { error: 'Empty braces: write a condition like {x > 0}' };
  if (parts.some((p) => !p)) return { error: 'Empty piece in { … }: remove the extra comma' };
  const conds: { cond: string; value: string }[] = [];
  let elseValue: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const at = pieceColon(p);
    if (at < 0) {
      if (parts.length === 1) {
        // {x > 0}: 1 where true, undefined elsewhere.
        if (!isConditionText(p)) return { error: `Braces need a condition, like {x > 0} (got {${p}})` };
        const c = desugar(p);
        if ('error' in c) return c;
        return { text: `((${conditionToMath(c.text)}) ? 1 : NaN)`, pieces: 1 };
      }
      if (i !== parts.length - 1) {
        return { error: `Each piece needs a condition, like {x < 0: -x, x^2} (got "${p}")` };
      }
      const v = desugar(p);
      if ('error' in v) return v;
      elseValue = v.text;
      continue;
    }
    const condRaw = p.slice(0, at).trim();
    const valueRaw = p.slice(at + 1).trim();
    if (!condRaw) return { error: `Missing condition before ":" in "${p}"` };
    if (!valueRaw) return { error: `Missing value after "${condRaw}:"` };
    if (!isConditionText(condRaw)) {
      return { error: `A piece's condition needs a comparison, like x < 0 (got "${condRaw}")` };
    }
    const c = desugar(condRaw);
    if ('error' in c) return c;
    const v = desugar(valueRaw);
    if ('error' in v) return v;
    conds.push({ cond: conditionToMath(c.text), value: v.text });
  }
  let text = elseValue != null ? `(${elseValue})` : 'NaN';
  for (let i = conds.length - 1; i >= 0; i--) text = `((${conds[i].cond}) ? (${conds[i].value}) : ${text})`;
  return { text, pieces: conds.length + (elseValue != null ? 1 : 0) };
}

/** Rewrite every `{ … }` group in `s` to its ternary. */
export function desugar(s: string): Result {
  if (!s.includes('{') && !s.includes('}')) return { text: s, pieces: 0 };
  let out = '';
  let pieces = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '}') return { error: 'Unmatched }' };
    if (c !== '{') {
      out += c;
      continue;
    }
    const close = matchBrace(s, i);
    if (close < 0) return { error: 'Unmatched {: close it with }' };
    const r = pieceText(s.slice(i + 1, close));
    if ('error' in r) return r;
    pieces = Math.max(pieces, r.pieces);
    // Right after an operand the braces multiply it (a restriction: x^2 {x > 0}).
    const before = out.trimEnd();
    if (before && endsWithOperand(before)) out = `${before} * `;
    out += r.text;
    i = close;
  }
  return { text: out, pieces };
}

/** Lenient rewrite used by normalizeInput (malformed braces are left alone, so
 * mathjs reports them; parse.ts checks `braceError` first for a clear message). */
export function desugarBraces(s: string): string {
  const r = desugar(s);
  return 'error' in r ? s : r.text;
}

/** A friendly message for malformed braces, or null. */
export function braceError(s: string): string | null {
  const r = desugar(s);
  return 'error' in r ? r.error : null;
}

/** A comma clause that is only a comparison chain (`0 < x < 2`): a restriction. */
function isComparisonClause(s: string): boolean {
  if (!/[<>≤≥]/.test(s) || /[?:{}]/.test(s)) return false;
  // A lone `=` would make it an equation (or an ODE condition y(0) = 1).
  return !/(^|[^<>=!])=(?!=)/.test(s);
}

/**
 * Trailing restrictions of a row: `y = x^2 {0 < x < 2} {x != 1}` or the comma
 * form `y = x^2, 0 < x < 2`. Returns the main text and the condition texts (as
 * typed), or null when there are none.
 */
export function splitRestrictions(text: string): { main: string; conds: string[] } | null {
  let main = text.trim();
  const conds: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    if (main.endsWith('}')) {
      // Find the matching `{` scanning backwards.
      let depth = 0;
      let open = -1;
      for (let i = main.length - 1; i >= 0; i--) {
        if (main[i] === '}') depth++;
        else if (main[i] === '{' && --depth === 0) {
          open = i;
          break;
        }
      }
      if (open <= 0) break;
      const before = main.slice(0, open).trimEnd();
      const inner = main.slice(open + 1, -1).trim();
      // Only a bare condition after an operand is a restriction ({x<0: 1, 2} after
      // an operand is a product with a piecewise value; after `=` it's the value).
      if (!before || !endsWithOperand(before)) break;
      if (!inner || pieceColon(inner) >= 0 || splitTop(inner, ',').length > 1) break;
      conds.unshift(inner);
      main = before;
      continue;
    }
    const clauses = splitTop(main, ',');
    if (clauses.length > 1 && isComparisonClause(clauses[clauses.length - 1])) {
      const last = clauses.pop()!.trim();
      const head = clauses.join(',').trim();
      if (!head) break;
      conds.unshift(last);
      main = head;
      continue;
    }
    break;
  }
  return conds.length ? { main, conds } : null;
}
