import { parse as mjParse, type MathNode } from 'mathjs';
import { freeSymbols } from './parse';
import { fmtSig } from '../format';

export interface PointSpec {
  /** Reference to a point-valued variable (e.g. an element of [A, B]). */
  ref?: string;
  tNode?: MathNode;
  yNode?: MathNode;
  /** Both coordinates are plain constants (no variables). */
  literal?: boolean;
  /** Name if the x-coordinate is a single variable symbol (drag updates it). */
  xSym?: string;
  /** Name if the y-coordinate is a single variable symbol. */
  ySym?: string;
}

/** The variable name if the node is exactly one (non-constant) symbol, else undefined. */
function loneSymbol(node: MathNode): string | undefined {
  if ((node as { type?: string }).type !== 'SymbolNode') return undefined;
  const name = (node as unknown as { name: string }).name;
  return freeSymbols(node).has(name) ? name : undefined;
}

export interface PointsParsed {
  points: PointSpec[];
  polyline: boolean;
  /** Written with [...] (scattered array) vs (...) — controls raw regeneration. */
  scattered: boolean;
}

/** Split on top-level `sep`, respecting () and [] nesting. */
function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

function parseOnePoint(str: string): PointSpec {
  let s = str.trim();
  // A bare identifier is a reference to a point-valued variable.
  if (/^[A-Za-z]\w*$/.test(s)) return { ref: s };
  if (!(s.startsWith('(') && s.endsWith(')'))) throw new Error('Expected a point (x, y)');
  s = s.slice(1, -1);
  const parts = splitTopLevel(s);
  if (parts.length !== 2) throw new Error('A point needs two coordinates');
  const tNode = mjParse(parts[0]);
  const yNode = mjParse(parts[1]);
  const literal = freeSymbols(tNode).size === 0 && freeSymbols(yNode).size === 0;
  return { tNode, yNode, literal, xSym: loneSymbol(tNode), ySym: loneSymbol(yNode) };
}

/**
 * Recognise point literals:
 *   (a, b)                  -> single point
 *   [(x1,y1), (x2,y2), …]   -> scattered point array
 *   ((x1,y1), (x2,y2), …)   -> connected polyline (parens-of-points)
 * Returns null if the text isn't a point expression.
 */
export function parsePoints(input: string): PointsParsed | null {
  const s = input.trim();

  if (s.startsWith('[') && s.endsWith(']')) {
    const list = splitTopLevel(s.slice(1, -1));
    return { points: list.map(parseOnePoint), polyline: false, scattered: true };
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1);
    const parts = splitTopLevel(inner);
    // Tuple of explicit points -> polyline: ((x1,y1),(x2,y2),…)
    if (parts.length >= 1 && parts.every((p) => p.startsWith('('))) {
      return { points: parts.map(parseOnePoint), polyline: parts.length > 1, scattered: false };
    }
    // 3+ bare identifiers -> polyline through point-variables: (A, B, C)
    if (parts.length >= 3 && parts.every((p) => /^[A-Za-z]\w*$/.test(p))) {
      return { points: parts.map((p) => ({ ref: p })), polyline: true, scattered: false };
    }
    // 2 elements -> a single point (a, b); reinterpreted as a line if both are
    // point-variables (handled at compute time).
    if (parts.length === 2) return { points: [parseOnePoint(s)], polyline: false, scattered: false };
  }
  return null;
}

/** Does this text look like a point expression (cheap pre-check)? */
export function looksLikePoints(input: string): boolean {
  const s = input.trim();
  if (s.startsWith('[') && s.includes('(')) return true;
  if (s.startsWith('(') && s.includes(',')) return true;
  return false;
}

function fmtNum(n: number): string {
  return fmtSig(n);
}

/** Regenerate raw text for a (draggable, all-literal) point entry. */
export function formatPointsRaw(
  coords: [number, number][],
  polyline: boolean,
  scattered: boolean,
): string {
  const pts = coords.map(([t, y]) => `(${fmtNum(t)}, ${fmtNum(y)})`);
  if (coords.length === 1 && !polyline) return pts[0];
  if (scattered) return `[${pts.join(', ')}]`;
  // A connected polyline is a parens-tuple of points: ((x1,y1), (x2,y2), …)
  return `(${pts.join(', ')})`;
}
