import { parse as mjParse } from 'mathjs';
import { parseEntry, normalizeInput } from './parse';
import type { Entry } from '../../store/types';

/** Variable name → current value, gathered from the variable entries. */
export function buildVarScope(entries: Entry[]): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const e of entries) {
    const p = parseEntry(e.raw);
    if (p.kind === 'variable') scope[p.name] = e.varValue ?? p.value;
  }
  return scope;
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
