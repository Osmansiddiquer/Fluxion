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
  /** A smooth path piece inside a polyline: `spline(P…)` through points,
   * `bezier(C1, C2, P)` / `bezier(C, P)` from the previous point, or
   * `arc(center, angle)` around a centre from the previous point. */
  seg?: PathSeg;
}

export type PathSeg =
  | { kind: 'spline'; points: PointSpec[] }
  | { kind: 'bezier'; points: PointSpec[] }
  | { kind: 'arc'; center: PointSpec; angle: MathNode };

/** Every expression node inside a point spec (recursing into path pieces). */
export function specNodes(sp: PointSpec): MathNode[] {
  const out: MathNode[] = [];
  if (sp.tNode) out.push(sp.tNode);
  if (sp.yNode) out.push(sp.yNode);
  if (sp.seg) {
    if (sp.seg.kind === 'arc') out.push(...specNodes(sp.seg.center), sp.seg.angle);
    else for (const q of sp.seg.points) out.push(...specNodes(q));
  }
  return out;
}

/** Point-variable names referenced by a spec (recursing into path pieces). */
export function specRefs(sp: PointSpec): string[] {
  const out: string[] = sp.ref ? [sp.ref] : [];
  if (sp.seg) {
    if (sp.seg.kind === 'arc') out.push(...specRefs(sp.seg.center));
    else for (const q of sp.seg.points) out.push(...specRefs(q));
  }
  return out;
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
  /** Contains spline / bezier / arc pieces (a smooth path, not a plain polyline). */
  smooth?: boolean;
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

/** Is `s` one parenthesised group — its opening `(` closes at the very end?
 * (`(a)*sin(t)` starts with `(` and ends with `)` but is not.) */
function isWrapped(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return true;
}

const SEG_CALL = /^(spline|bezier|arc)\s*\(/;

/** `name(…)` where the `(` closes at the very end. */
function segCall(s: string): { kind: 'spline' | 'bezier' | 'arc'; args: string[] } | null {
  const m = SEG_CALL.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length - 1);
  if (!isWrapped(rest)) return null;
  return { kind: m[1] as 'spline' | 'bezier' | 'arc', args: splitTopLevel(rest.slice(1, -1)) };
}

function parseSeg(call: { kind: 'spline' | 'bezier' | 'arc'; args: string[] }): PointSpec {
  const { kind, args } = call;
  if (kind === 'arc') {
    if (args.length !== 2) throw new Error('arc needs a centre and an angle: arc((cx, cy), angle)');
    return { seg: { kind, center: parseOnePoint(args[0], false), angle: mjParse(args[1]) } };
  }
  if (kind === 'bezier' && (args.length < 2 || args.length > 3)) {
    throw new Error('bezier needs control point(s) and an end point: bezier((c1), (c2), (end))');
  }
  if (kind === 'spline' && args.length < 1) throw new Error('spline needs points: spline((x1, y1), (x2, y2), …)');
  return { seg: { kind, points: args.map((a) => parseOnePoint(a, false)) } };
}

function parseOnePoint(str: string, allowSeg = true): PointSpec {
  let s = str.trim();
  if (allowSeg) {
    const call = segCall(s);
    if (call) return parseSeg(call);
  }
  // A bare identifier is a reference to a point-valued variable.
  if (/^[A-Za-z]\w*$/.test(s)) return { ref: s };
  if (!isWrapped(s)) throw new Error('Expected a point (x, y)');
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

  // A smooth curve through points: spline((x1, y1), (x2, y2), …).
  const top = segCall(s);
  if (top) {
    if (top.kind !== 'spline') throw new Error(`${top.kind} goes inside a path: ((x0, y0), ${top.kind}(…))`);
    return { points: [parseSeg(top)], polyline: true, scattered: false, smooth: true };
  }

  if (s.startsWith('[') && s.endsWith(']')) {
    const list = splitTopLevel(s.slice(1, -1));
    return { points: list.map((p) => parseOnePoint(p)), polyline: false, scattered: true };
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1);
    const parts = splitTopLevel(inner);
    // Tuple of explicit points -> polyline: ((x1,y1),(x2,y2),…), possibly with
    // smooth pieces: ((0, 0), spline((1, 2), (2, 1)), bezier((3, 0), (4, 2), (5, 0)))
    if (parts.length >= 1 && parts.every((p) => isWrapped(p) || segCall(p))) {
      const points = parts.map((p) => parseOnePoint(p));
      const smooth = points.some((p) => p.seg);
      if (points[0].seg && points[0].seg.kind !== 'spline') {
        throw new Error(`A path must start with a point before ${points[0].seg.kind}(…)`);
      }
      return { points, polyline: parts.length > 1 || smooth, scattered: false, ...(smooth ? { smooth } : {}) };
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
  if (/^(spline|bezier|arc)\s*\(/.test(s)) return true;
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
