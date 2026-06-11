import { FUNCTION_SUGGESTIONS, CONSTANTS } from './builtins';
import { GREEK_WORDS } from './greek';

const FUNCTION_SET = new Set(FUNCTION_SUGGESTIONS);

export interface TokenCtx {
  token: string;
  start: number;
  end: number;
}

/** The identifier run ending at the caret (the prefix being typed). */
export function tokenAtCaret(value: string, caret: number): TokenCtx {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) start--;
  return { token: value.slice(start, caret), start, end: caret };
}

/** Suggestions (functions, constants, Greek, variables) matching a prefix. */
export function suggestionsFor(prefix: string, varNames: string[]): string[] {
  if (prefix.length < 1) return [];
  const p = prefix.toLowerCase();
  const pool = [...FUNCTION_SUGGESTIONS, ...CONSTANTS, ...GREEK_WORDS, ...varNames];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of pool) {
    const low = s.toLowerCase();
    if (low === p || seen.has(s) || !low.startsWith(p)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

export function isFunctionName(name: string): boolean {
  return FUNCTION_SET.has(name);
}
