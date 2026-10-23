import { derivative, type MathNode } from 'mathjs';
import { hasSymbol, type Parsed } from '../math/parse';
import { compileNode } from '../math/compileCache';
import type { OdeSystem } from '../math/reduce';

/**
 * Equilibria (fixed points) of autonomous ODEs and their stability.
 *
 * - 1-D (`y' = f(y)`): the zeros of f in a y-range. Stability comes from the
 *   sign of f on either side (which also handles f'(y*) = 0): flow towards the
 *   point from both sides = stable, away from it = unstable, through it =
 *   semi-stable.
 * - 2-D (`x' = f(x, y), y' = g(x, y)`, or `y'' = g(y, y')` read as (y, y')):
 *   Newton's method from a grid of seeds over the view, then the Jacobian's
 *   eigenvalues (trace / determinant) classify the point as a node, saddle,
 *   spiral, centre or degenerate case. The Jacobian comes from mathjs
 *   `derivative`, falling back to central differences where the expression
 *   can't be differentiated symbolically (user functions, piecewise, …).
 *
 * Systems that read `t` (non-autonomous) have no equilibria: the caller gets
 * `{ autonomous: false }`.
 */

export type Stability = 'stable' | 'unstable' | 'semi-stable' | 'saddle' | 'neutral' | 'degenerate';

export interface Complex {
  re: number;
  im: number;
}

export interface Equilibrium {
  /** The fixed point in state coordinates ([y*] in 1-D, [x*, y*] in 2-D). */
  point: number[];
  stability: Stability;
  /** Human label: "stable node", "saddle", "unstable spiral", "centre", "semi-stable", … */
  type: string;
  /** 1-D: f'(y*). */
  slope?: number;
  /** 2-D: Jacobian rows and its eigenvalues. */
  jacobian?: number[][];
  eigenvalues?: [Complex, Complex];
}

export interface EquilibriaResult {
  autonomous: boolean;
  list: Equilibrium[];
}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

const MAX_EQUILIBRIA = 40;

// ── 1-D ─────────────────────────────────────────────────────────────────────

const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Classify a 1-D equilibrium from the signs of f just left and right of it. */
export function classify1D(left: number, right: number): { stability: Stability; type: string } {
  const l = sgn(left);
  const r = sgn(right);
  if (l > 0 && r < 0) return { stability: 'stable', type: 'stable' };
  if (l < 0 && r > 0) return { stability: 'unstable', type: 'unstable' };
  if (l !== 0 && l === r) return { stability: 'semi-stable', type: 'semi-stable' };
  return { stability: 'degenerate', type: 'degenerate' };
}

function bisect(f: (y: number) => number, a: number, b: number, fa: number): number {
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0 || b - a < 1e-15 * Math.max(1, Math.abs(m))) return m;
    if (sgn(fm) === sgn(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

/** Golden-section minimum of |f| on [a, b] (for zeros f touches without crossing). */
function minAbs(f: (y: number) => number, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = Math.abs(f(c));
  let fd = Math.abs(f(d));
  for (let i = 0; i < 90; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = Math.abs(f(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = Math.abs(f(d));
    }
  }
  return (a + b) / 2;
}

/**
 * Zeros of f on [lo, hi] (crossings and touching zeros), classified. `fprime`
 * (optional) reports the slope; stability comes from the side signs.
 */
export function equilibria1D(
  f: (y: number) => number,
  lo: number,
  hi: number,
  fprime?: (y: number) => number,
  n = 600,
): Equilibrium[] {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const ys = new Float64Array(n + 1);
  const fs = new Float64Array(n + 1);
  let scale = 0;
  for (let i = 0; i <= n; i++) {
    ys[i] = lo + (i / n) * span;
    const v = f(ys[i]);
    fs[i] = v;
    if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
  }
  // f ≡ 0: every point is an equilibrium — nothing to mark.
  if (scale === 0) return [];
  const roots: number[] = [];
  for (let i = 0; i <= n && roots.length <= MAX_EQUILIBRIA; i++) {
    const a = fs[i];
    if (!Number.isFinite(a)) continue;
    if (a === 0) {
      roots.push(ys[i]);
      continue;
    }
    if (i < n) {
      const b = fs[i + 1];
      if (Number.isFinite(b) && b !== 0 && sgn(a) !== sgn(b)) {
        // A sign change across a pole (tan, 1/y) is not a zero: check the value.
        const r = bisect(f, ys[i], ys[i + 1], a);
        if (Math.abs(f(r)) <= 1e-6 * scale) roots.push(r);
        continue;
      }
    }
    // Touching zero: a local minimum of |f| with no sign change around it.
    if (i > 0 && i < n) {
      const p = fs[i - 1];
      const q = fs[i + 1];
      if (
        Number.isFinite(p) &&
        Number.isFinite(q) &&
        Math.abs(a) <= Math.abs(p) &&
        Math.abs(a) < Math.abs(q) &&
        sgn(p) === sgn(a) &&
        sgn(q) === sgn(a) &&
        Math.abs(a) < 0.05 * scale
      ) {
        const r = minAbs(f, ys[i - 1], ys[i + 1]);
        if (Math.abs(f(r)) <= 1e-9 * scale + 1e-14) roots.push(r);
      }
    }
  }
  const eps = 1e-7 * span;
  const uniq: number[] = [];
  for (const r of roots.sort((x, y) => x - y)) {
    if (!uniq.length || r - uniq[uniq.length - 1] > eps) uniq.push(r);
  }
  const delta = Math.max(1e-6 * span, 1e-9);
  return uniq.slice(0, MAX_EQUILIBRIA).map((r) => {
    // Snap tiny round-off (-1e-17 → 0) so labels read cleanly.
    const y = Math.abs(r) < 1e-12 * Math.max(1, span) ? 0 : r;
    const { stability, type } = classify1D(f(y - delta), f(y + delta));
    const out: Equilibrium = { point: [y], stability, type };
    const s = fprime ? fprime(y) : (f(y + delta) - f(y - delta)) / (2 * delta);
    if (Number.isFinite(s)) out.slope = Math.abs(s) < 1e-12 ? 0 : s;
    return out;
  });
}

// ── 2-D ─────────────────────────────────────────────────────────────────────

/** Eigenvalues of a real 2×2 matrix. */
export function eigen2(J: number[][]): [Complex, Complex] {
  const [[a, b], [c, d]] = J;
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [
      { re: (tr + s) / 2, im: 0 },
      { re: (tr - s) / 2, im: 0 },
    ];
  }
  const s = Math.sqrt(-disc) / 2;
  return [
    { re: tr / 2, im: s },
    { re: tr / 2, im: -s },
  ];
}

/**
 * Classify a planar fixed point from its Jacobian (trace–determinant plane).
 * `tol` is the relative tolerance for "zero" (looser for a numeric Jacobian).
 */
export function classify2D(J: number[][], tol = 1e-9): { stability: Stability; type: string } {
  const [[a, b], [c, d]] = J;
  const s = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!(s > 0)) return { stability: 'degenerate', type: 'degenerate (zero Jacobian)' };
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  const zero2 = tol * s * s;
  if (Math.abs(det) <= zero2) return { stability: 'degenerate', type: 'degenerate (zero eigenvalue)' };
  if (det < 0) return { stability: 'saddle', type: 'saddle' };
  const dir = tr < 0 ? 'stable' : 'unstable';
  if (Math.abs(tr) <= tol * s && disc < 0) return { stability: 'neutral', type: 'centre' };
  if (Math.abs(disc) <= zero2) return { stability: dir, type: `${dir} degenerate node` };
  if (disc > 0) return { stability: dir, type: `${dir} node` };
  return { stability: dir, type: `${dir} spiral` };
}

function solve2(J: number[][], F: [number, number]): [number, number] | null {
  const [[a, b], [c, d]] = J;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) return null;
  return [(d * F[0] - b * F[1]) / det, (-c * F[0] + a * F[1]) / det];
}

export interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Central-difference Jacobian of a planar map. */
export function numericJacobian(F: (x: number, y: number) => [number, number], x: number, y: number): number[][] {
  const hx = 1e-6 * Math.max(1, Math.abs(x));
  const hy = 1e-6 * Math.max(1, Math.abs(y));
  const fxp = F(x + hx, y);
  const fxm = F(x - hx, y);
  const fyp = F(x, y + hy);
  const fym = F(x, y - hy);
  return [
    [(fxp[0] - fxm[0]) / (2 * hx), (fyp[0] - fym[0]) / (2 * hy)],
    [(fxp[1] - fxm[1]) / (2 * hx), (fyp[1] - fym[1]) / (2 * hy)],
  ];
}

/**
 * Fixed points of a planar map F inside `box`: damped Newton from a grid of
 * seeds, deduplicated, classified by the Jacobian `jac` (symbolic when
 * available; `exact` tightens the zero tolerance).
 */
export function equilibria2D(
  F: (x: number, y: number) => [number, number],
  box: Box,
  jac?: (x: number, y: number) => number[][] | null,
  exact = false,
  seeds = 9,
): Equilibrium[] {
  const w = box.xMax - box.xMin;
  const h = box.yMax - box.yMin;
  if (!(w > 0 && h > 0)) return [];
  const J = (x: number, y: number) => {
    const m = jac?.(x, y);
    return m && m.every((r) => r.every(Number.isFinite)) ? m : numericJacobian(F, x, y);
  };
  const norm = (v: [number, number]) => Math.max(Math.abs(v[0]), Math.abs(v[1]));
  // Typical |F| over the seeds sets the "zero" threshold.
  let scale = 0;
  const starts: [number, number][] = [];
  for (let i = 0; i < seeds; i++) {
    for (let j = 0; j < seeds; j++) {
      const x = box.xMin + ((i + 0.5) / seeds) * w;
      const y = box.yMin + ((j + 0.5) / seeds) * h;
      starts.push([x, y]);
      const v = F(x, y);
      if (Number.isFinite(v[0]) && Number.isFinite(v[1])) scale = Math.max(scale, norm(v));
    }
  }
  if (!(scale > 0)) return [];
  const tolF = 1e-10 * scale + 1e-13;
  const found: [number, number][] = [];
  const near = (p: [number, number]) =>
    found.some((q) => Math.abs(q[0] - p[0]) <= 1e-6 * w && Math.abs(q[1] - p[1]) <= 1e-6 * h);
  const mx = 0.02 * w;
  const my = 0.02 * h;
  for (const s of starts) {
    let p: [number, number] = [s[0], s[1]];
    let v = F(p[0], p[1]);
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
    let ok = false;
    for (let it = 0; it < 50; it++) {
      if (norm(v) <= tolF) {
        ok = true;
        break;
      }
      const step = solve2(J(p[0], p[1]), v);
      if (!step) break;
      // Damped: halve the step until |F| decreases.
      let lam = 1;
      let moved = false;
      for (let k = 0; k < 12; k++) {
        const q: [number, number] = [p[0] - lam * step[0], p[1] - lam * step[1]];
        const vq = F(q[0], q[1]);
        if (Number.isFinite(vq[0]) && Number.isFinite(vq[1]) && norm(vq) < norm(v)) {
          p = q;
          v = vq;
          moved = true;
          break;
        }
        lam /= 2;
      }
      if (!moved) break;
      // Wandered far away: give up on this seed.
      if (Math.abs(p[0] - s[0]) > 4 * w || Math.abs(p[1] - s[1]) > 4 * h) break;
    }
    if (!ok && norm(v) <= tolF * 10) ok = true;
    if (!ok) continue;
    // Polish: a few undamped Newton steps (quadratic convergence) so the point is
    // exact to round-off, not just inside the acceptance tolerance.
    for (let k = 0; k < 4; k++) {
      const step = solve2(J(p[0], p[1]), v);
      if (!step) break;
      const q: [number, number] = [p[0] - step[0], p[1] - step[1]];
      const vq = F(q[0], q[1]);
      if (!Number.isFinite(vq[0]) || !Number.isFinite(vq[1]) || norm(vq) > norm(v)) break;
      p = q;
      v = vq;
    }
    if (p[0] < box.xMin - mx || p[0] > box.xMax + mx || p[1] < box.yMin - my || p[1] > box.yMax + my) continue;
    if (!near(p)) found.push(p);
    if (found.length >= MAX_EQUILIBRIA) break;
  }
  const snap = (v: number, span: number) => (Math.abs(v) < 1e-12 * Math.max(1, span) ? 0 : v);
  return found
    .map((p): [number, number] => [snap(p[0], w), snap(p[1], h)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((p) => {
      const jm = J(p[0], p[1]);
      const tol = exact && jac?.(p[0], p[1]) ? 1e-9 : 1e-5;
      const { stability, type } = classify2D(jm, tol);
      const clean = jm.map((r) => r.map((x) => (Math.abs(x) < 1e-12 ? 0 : x)));
      return { point: p, stability, type, jacobian: clean, eigenvalues: eigen2(clean) };
    });
}

// ── Systems (from the parsed ODEs) ──────────────────────────────────────────

/** Does any equation read the independent variable t? */
export function isAutonomous(odes: OdeParsed[]): boolean {
  return !odes.some((o) => hasSymbol(o.node, 't'));
}

/**
 * Symbolic Jacobian of a reduced system: row i, column j = ∂(dYᵢ/dt)/∂Yⱼ, as
 * evaluators, or null if some right-hand side can't be differentiated.
 */
export function symbolicJacobian(
  odes: OdeParsed[],
  system: OdeSystem,
  scope: Record<string, number>,
): ((Y: number[], t?: number) => number[][]) | null {
  const names = Object.keys(system.index);
  const { dim } = system;
  // Entry (row, col) → constant 0/1 or an evaluator.
  const rows: (number | { evaluate: (s: object) => unknown })[][] = [];
  try {
    for (let b = 0; b < system.blocks.length; b++) {
      const { order, offset } = system.blocks[b];
      for (let k = 0; k < order - 1; k++) {
        const row = new Array<number>(dim).fill(0);
        row[offset + k + 1] = 1;
        rows[offset + k] = row;
      }
      const row: (number | { evaluate: (s: object) => unknown })[] = [];
      for (let j = 0; j < dim; j++) {
        const name = names.find((n) => system.index[n] === j)!;
        const d: MathNode = derivative(odes[b].node, name);
        const txt = d.toString();
        row[j] = txt === '0' ? 0 : compileNode(d, names);
      }
      rows[offset + order - 1] = row;
    }
  } catch {
    return null;
  }
  const sc: Record<string, number> = { ...scope };
  return (Y, t = 0) => {
    sc.t = t;
    for (const n of names) sc[n] = Y[system.index[n]];
    return rows.map((r) =>
      r.map((c) => {
        if (typeof c === 'number') return c;
        const v = c.evaluate(sc);
        return typeof v === 'number' ? v : NaN;
      }),
    );
  };
}

/**
 * Equilibria of a reduced system (1-D or 2-D state) inside the given state
 * box. 1-D uses [yLo, yHi] = [box.yMin, box.yMax].
 */
export function systemEquilibria(
  odes: OdeParsed[],
  system: OdeSystem,
  scope: Record<string, number>,
  box: Box,
): EquilibriaResult {
  if (!isAutonomous(odes)) return { autonomous: false, list: [] };
  if (system.dim !== 1 && system.dim !== 2) return { autonomous: true, list: [] };
  const jac = symbolicJacobian(odes, system, scope);
  if (system.dim === 1) {
    const f = (y: number) => {
      const v = system.deriv(0, [y])[0];
      return typeof v === 'number' ? v : NaN;
    };
    const fp = jac ? (y: number) => jac([y])[0][0] : undefined;
    return { autonomous: true, list: equilibria1D(f, box.yMin, box.yMax, fp) };
  }
  const F = (x: number, y: number): [number, number] => {
    const d = system.deriv(0, [x, y]);
    return [d[0], d[1]];
  };
  return {
    autonomous: true,
    list: equilibria2D(F, box, jac ? (x, y) => jac([x, y]) : undefined, !!jac),
  };
}

/** Text lines for an equilibrium's tooltip (classification, eigenvalues, Jacobian). */
export function describeEquilibrium(eq: Equilibrium, fmt: (n: number) => string): string[] {
  const lines: string[] = [];
  if (eq.slope !== undefined) lines.push(`f′ = ${fmt(eq.slope)}`);
  if (eq.eigenvalues) {
    const c = (z: Complex) =>
      z.im === 0 ? fmt(z.re) : `${fmt(z.re)} ${z.im < 0 ? '−' : '+'} ${fmt(Math.abs(z.im))}i`;
    lines.push(`λ = ${c(eq.eigenvalues[0])}, ${c(eq.eigenvalues[1])}`);
  }
  if (eq.jacobian) {
    lines.push(`J = [${eq.jacobian.map((r) => r.map(fmt).join(', ')).join('; ')}]`);
  }
  return lines;
}
