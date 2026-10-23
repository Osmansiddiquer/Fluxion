import { OP } from '../script/protocol';

/**
 * Smooth path geometry, shared by Graph-mode point paths (`spline(…)`,
 * `bezier(…)`, `arc(…)` inside a polyline) and available to Script mode.
 *
 * Paths are built as op-coded number arrays in Script mode's wire format
 * (`OP.move x y`, `OP.line x y`, `OP.cubic c1x c1y c2x c2y x y`, `OP.close`),
 * in data coordinates, then flattened to a polyline for the parts of the app
 * that work on points (fills, tracing, hit-testing, intersections).
 */

export type Pt = [number, number];

/** A path under construction: `ops` plus the current point. */
export class PathBuilder {
  ops: number[] = [];
  cur: Pt | null = null;
  moveTo(p: Pt): void {
    this.ops.push(OP.move, p[0], p[1]);
    this.cur = p;
  }
  lineTo(p: Pt): void {
    if (!this.cur) return this.moveTo(p);
    this.ops.push(OP.line, p[0], p[1]);
    this.cur = p;
  }
  cubicTo(c1: Pt, c2: Pt, p: Pt): void {
    if (!this.cur) this.moveTo(c1);
    this.ops.push(OP.cubic, c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
    this.cur = p;
  }
  /** Quadratic Bézier as the equivalent cubic. */
  quadTo(c: Pt, p: Pt): void {
    const s = this.cur ?? c;
    this.cubicTo(
      [s[0] + (2 / 3) * (c[0] - s[0]), s[1] + (2 / 3) * (c[1] - s[1])],
      [p[0] + (2 / 3) * (c[0] - p[0]), p[1] + (2 / 3) * (c[1] - p[1])],
      p,
    );
  }
  close(): void {
    this.ops.push(OP.close);
  }

  /**
   * A smooth curve through `pts` from the current point (centripetal
   * Catmull-Rom: no cusps or self-loops on uneven spacing, unlike uniform).
   * `closed`: the run is a loop (its last point equals its first), so the
   * tangent wraps across the seam. `before` / `after` are neighbours that shape
   * the end tangents (the polyline's points on either side), if any.
   */
  splineThrough(pts: Pt[], opts: { closed?: boolean; before?: Pt; after?: Pt } = {}): void {
    const all = this.cur ? [this.cur, ...pts] : pts.slice();
    if (!this.cur && all.length) this.moveTo(all[0]);
    if (all.length < 2) return;
    const closed = !!opts.closed && all.length >= 4 && samePt(all[0], all[all.length - 1]);
    const n = all.length;
    const at = (i: number): Pt => {
      if (closed) {
        // Points 0 and n-1 are the same: index modulo n-1.
        const m = n - 1;
        return all[((i % m) + m) % m];
      }
      if (i < 0) return opts.before ?? reflect(all[0], all[1]);
      if (i >= n) return opts.after ?? reflect(all[n - 1], all[n - 2]);
      return all[i];
    };
    for (let i = 0; i < n - 1; i++) {
      const [c1, c2] = catmullRomControls(at(i - 1), at(i), at(i + 1), at(i + 2));
      this.cubicTo(c1, c2, all[i + 1]);
    }
  }

  /** An arc around `center` by `angle` radians (positive = counter-clockwise),
   * starting at the current point; split into ≤ 90° cubic pieces. */
  arcAround(center: Pt, angle: number): void {
    const p = this.cur;
    if (!p || !Number.isFinite(angle) || angle === 0) return;
    const r = Math.hypot(p[0] - center[0], p[1] - center[1]);
    if (!(r > 0)) return;
    let a0 = Math.atan2(p[1] - center[1], p[0] - center[0]);
    const pieces = Math.min(64, Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2))));
    const d = angle / pieces;
    const k = (4 / 3) * Math.tan(d / 4);
    for (let i = 0; i < pieces; i++) {
      const a1 = a0 + d;
      const s0: Pt = [center[0] + r * Math.cos(a0), center[1] + r * Math.sin(a0)];
      const s1: Pt = [center[0] + r * Math.cos(a1), center[1] + r * Math.sin(a1)];
      this.cubicTo(
        [s0[0] - k * r * Math.sin(a0), s0[1] + k * r * Math.cos(a0)],
        [s1[0] + k * r * Math.sin(a1), s1[1] - k * r * Math.cos(a1)],
        s1,
      );
      a0 = a1;
    }
  }
}

function samePt(a: Pt, b: Pt): boolean {
  return Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
}
function reflect(p: Pt, q: Pt): Pt {
  return [2 * p[0] - q[0], 2 * p[1] - q[1]];
}

/** Bézier controls of the centripetal Catmull-Rom span p1 → p2 (α = 0.5). */
export function catmullRomControls(p0: Pt, p1: Pt, p2: Pt, p3: Pt): [Pt, Pt] {
  const d = (a: Pt, b: Pt) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
  const d1 = d(p0, p1);
  const d2 = d(p1, p2);
  const d3 = d(p2, p3);
  if (d2 === 0) return [p1, p2];
  const c1: Pt =
    d1 === 0
      ? p1
      : [
          (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
          (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
        ];
  const c2: Pt =
    d3 === 0
      ? p2
      : [
          (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
          (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
        ];
  return [c1, c2];
}

/**
 * Flatten path ops to polylines (one per subpath). Each cubic is split into
 * enough pieces that every piece spans about `tol` data units (by its control
 * polygon length), between 2 and 64 — or exactly `perCubic` pieces if given.
 */
export function flattenOps(ops: number[], tol: number, perCubic?: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let start: Pt | null = null;
  let last: Pt | null = null;
  const flush = () => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  for (let i = 0; i < ops.length; ) {
    switch (ops[i]) {
      case OP.move:
        flush();
        last = start = [ops[i + 1], ops[i + 2]];
        cur.push(last);
        i += 3;
        break;
      case OP.line:
        last = [ops[i + 1], ops[i + 2]];
        cur.push(last);
        i += 3;
        break;
      case OP.cubic: {
        const p0 = last ?? [ops[i + 1], ops[i + 2]];
        const c1: Pt = [ops[i + 1], ops[i + 2]];
        const c2: Pt = [ops[i + 3], ops[i + 4]];
        const p3: Pt = [ops[i + 5], ops[i + 6]];
        const len =
          Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) +
          Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
          Math.hypot(p3[0] - c2[0], p3[1] - c2[1]);
        const n = perCubic ?? Math.max(2, Math.min(64, Math.ceil(len / Math.max(1e-12, tol))));
        for (let k = 1; k <= n; k++) {
          const u = k / n;
          const v = 1 - u;
          const a = v * v * v;
          const b = 3 * v * v * u;
          const c = 3 * v * u * u;
          const d = u * u * u;
          cur.push([
            a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
          ]);
        }
        last = p3;
        i += 7;
        break;
      }
      case OP.close:
        if (start && last && !samePt(start, last)) cur.push(start);
        last = start;
        i += 1;
        break;
      default:
        i = ops.length; // unknown op: stop
    }
  }
  flush();
  return out;
}
