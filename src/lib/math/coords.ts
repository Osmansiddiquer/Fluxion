/**
 * Point coordinates, Desmos-style: `A.x` / `A.y` read the coordinates of a named
 * point `A = (…, …)`.
 *
 * mathjs would parse `A.x` as a property access on an object. Links are
 * untrusted, so that path is never used: `normalizeInput` rewrites `A.x` to the
 * plain symbol `A__x`, and lib/scope.ts defines `A__x` / `A__y` as numbers once
 * A's coordinates are resolved. Nothing ever reads a property of an object.
 */

export const COORD_SEP = '__';
export const COORD_PROPS = ['x', 'y'] as const;

// `name.prop` with name an identifier (not the tail of another accessor a.b.c;
// a digit before it is a coefficient: 2center.x) and prop an identifier.
const ACCESS = /(?<![A-Za-z_.])([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/g;

/** `A.x` → `A__x` (any property name; unknown ones are reported later). */
export function rewriteCoords(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(ACCESS, (_m, name: string, prop: string) => `${name}${COORD_SEP}${prop}`);
}

/** The internal symbol for a coordinate of point `name`. */
export function coordSymbol(name: string, prop: 'x' | 'y'): string {
  return `${name}${COORD_SEP}${prop}`;
}

/** `A__x` → { point: 'A', prop: 'x' }; null for an ordinary name. */
export function splitCoord(sym: string): { point: string; prop: string } | null {
  const i = sym.lastIndexOf(COORD_SEP);
  if (i <= 0 || i + COORD_SEP.length >= sym.length) return null;
  const point = sym.slice(0, i);
  const prop = sym.slice(i + COORD_SEP.length);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(point) || point.endsWith('_') || !/^[A-Za-z][A-Za-z0-9]*$/.test(prop)) return null;
  return { point, prop };
}

/** `A__x` → `A.x` inside a message (mathjs errors name the internal symbol). */
export function prettyCoords(msg: string): string {
  if (!msg.includes(COORD_SEP)) return msg;
  return msg.replace(/\b(?!sol__)([A-Za-z][A-Za-z0-9_]*?)__([A-Za-z][A-Za-z0-9]*)\b/g, '$1.$2');
}

/** A property access left after the rewrite — `(A).x`, `f(1).y`, `A.x.y`,
 * `A .x` — which mathjs would evaluate as one: refused at parse time. */
export function leftoverAccess(s: string): boolean {
  return /[A-Za-z_)\]]\s*\.\s*[A-Za-z_]/.test(s);
}
