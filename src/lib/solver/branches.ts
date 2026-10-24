import type { MathNode } from 'mathjs';
import { compileNode } from '../math/compileCache';
import type { Point } from './curve';

/**
 * Piecewise support for the samplers. `branchOf(node)` reads every condition of
 * the expression's ternaries ({x < 0: -x, x^2} and restrictions) and returns a
 * function giving the branch taken at a scope as a bitmask, or undefined when
 * the expression has no conditions. Samplers bisect where it changes, so piece
 * edges are exact and jumps aren't joined.
 */
export function branchOf(
  nodes: MathNode | MathNode[],
  rename?: Record<string, string>,
): ((s: Record<string, number>) => number) | undefined {
  const conds: MathNode[] = [];
  const seen = new Set<string>();
  for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
    node.traverse((n: MathNode) => {
      if ((n as { type: string }).type !== 'ConditionalNode' || conds.length >= 30) return;
      const c = (n as unknown as { condition: MathNode }).condition;
      const key = c.toString();
      if (seen.has(key)) return;
      seen.add(key);
      conds.push(c);
    });
  }
  if (!conds.length) return undefined;
  const evs = conds.map((c) => compileNode(c));
  const ren = rename ? Object.entries(rename) : [];
  return (s) => {
    for (const [to, from] of ren) s[to] = s[from];
    let mask = 0;
    for (let i = 0; i < evs.length; i++) {
      let v: unknown;
      try {
        v = evs[i].evaluate(s);
      } catch {
        v = false;
      }
      if (v === true || (typeof v === 'number' && v)) mask |= 1 << i;
    }
    return mask;
  };
}

/**
 * Sample a curve point(u) for u in [u0, u1] (N steps), breaking where it's
 * undefined. With `branch`, edges where it becomes undefined are bisected (a
 * restricted polar / parametric curve ends exactly on its bound) and piece
 * switches are located exactly, splitting the curve at jumps.
 */
export function sampleCurve(
  at: (u: number) => Point | null,
  u0: number,
  u1: number,
  N: number,
  branch?: (u: number) => number,
): Point[][] {
  const segments: Point[][] = [];
  let cur: Point[] = [];
  const flush = () => {
    if (cur.length >= 2) segments.push(cur);
    cur = [];
  };
  const bisect = (a: number, b: number, same: (u: number) => boolean): [number, number] => {
    let lo = a;
    let hi = b;
    for (let k = 0; k < 44; k++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (same(mid)) lo = mid;
      else hi = mid;
    }
    return [lo, hi];
  };
  const close = (p: Point, q: Point) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1e-6 * (1 + Math.hypot(p[0], p[1]));
  let prevU = NaN;
  let prev: Point | null = null;
  let prevB = 0;
  for (let i = 0; i <= N; i++) {
    const u = u0 + (i / N) * (u1 - u0);
    const p = at(u);
    const b = p && branch ? branch(u) : 0;
    if (branch && i > 0) {
      if (p && !prev) {
        // Entering the domain: start on its edge.
        const [, hi] = bisect(prevU, u, (m) => !at(m));
        const e = at(hi);
        if (e) cur.push(e);
      } else if (!p && prev) {
        const [lo] = bisect(prevU, u, (m) => !!at(m));
        const e = at(lo);
        if (e) cur.push(e);
      } else if (p && prev && b !== prevB) {
        const [lo, hi] = bisect(prevU, u, (m) => !!at(m) && branch(m) === prevB);
        const a = at(lo);
        const c = at(hi);
        if (a) cur.push(a);
        if (!a || !c || !close(a, c)) flush();
        if (c) cur.push(c);
      }
    }
    if (p) cur.push(p);
    else flush();
    prevU = u;
    prev = p;
    prevB = b;
  }
  flush();
  return segments;
}

/** A restriction predicate (the `restrict` node is 1 inside, NaN outside). */
export function restrictionTest(
  node: MathNode,
  scope: Record<string, number>,
): (set: (s: Record<string, number>) => void) => boolean {
  const ev = compileNode(node);
  const s: Record<string, number> = { ...scope };
  return (set) => {
    set(s);
    try {
      const v = ev.evaluate(s);
      return typeof v === 'number' && Number.isFinite(v);
    } catch {
      return false;
    }
  };
}

/**
 * Keep the parts of polylines where `inside(p)` holds. Where it switches along a
 * piece [a, b], the boundary is bisected on the straight line between them, so a
 * clipped curve ends on the restriction's edge.
 */
export function clipSegments(segments: Point[][], inside: (p: Point) => boolean): Point[][] {
  const out: Point[][] = [];
  for (const seg of segments) {
    let cur: Point[] = [];
    let prevIn = false;
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const ok = inside(p);
      if (i > 0 && ok !== prevIn) {
        const a = seg[i - 1];
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          const m: Point = [a[0] + (p[0] - a[0]) * mid, a[1] + (p[1] - a[1]) * mid];
          if (inside(m) === prevIn) lo = mid;
          else hi = mid;
        }
        const f = prevIn ? lo : hi;
        const edge: Point = [a[0] + (p[0] - a[0]) * f, a[1] + (p[1] - a[1]) * f];
        if (prevIn) {
          cur.push(edge);
          if (cur.length >= 2) out.push(cur);
          cur = [];
        } else {
          cur = [edge];
        }
      }
      if (ok) cur.push(p);
      prevIn = ok;
    }
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}
