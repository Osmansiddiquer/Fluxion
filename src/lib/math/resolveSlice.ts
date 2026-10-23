import { parse as mjParse } from 'mathjs';
import { parseEntry, normalizeInput } from './parse';
import type { Entry } from '../../store/types';
import { buildEvalContext } from '../scope';

/** The evaluation scope for these entries: variable values, derived values,
 * user functions and scripting helpers (see lib/scope.ts). */
export function buildVarScope(entries: Entry[]): Record<string, number> {
  return buildEvalContext(entries.map((entry) => ({ entry, parsed: parseEntry(entry.raw) }))).scope;
}

/** Evaluate a panel slice expression against the variable scope, or null if it
 * references something undefined / doesn't yield a finite number. */
export function resolveSlice(expr: string, scope: Record<string, number>): number | null {
  try {
    const v = mjParse(normalizeInput(expr)).compile().evaluate(scope);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
