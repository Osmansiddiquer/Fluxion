import type { MathNode } from 'mathjs';
import {
  parseEntry,
  calledFunctions,
  hasSymbol,
  loopValues,
  type LoopSpec,
  type Parsed,
} from './math/parse';
import { buildSystem } from './math/reduce';
import { compileNode } from './math/compileCache';
import { KNOWN_FUNCTIONS } from './math/builtins';
import type { Trajectory } from './solver/integrate';
import { applyOdeNotation, forcing, odeGroups, resolveGroupSetup, runGroup, type OdeNumerics } from './solver/odeGroup';
import { SOLUTION_IN_EQUATION, shieldCalls, solutionLabel, whileSolving } from './solver/solutions';
import { sampleFunction } from './solver/sample';
import { sampleImplicit } from './solver/implicit';
import { EMPTY_CURVE, type Point, type SampledCurve } from './solver/curve';
import { buildEvalContext, isDerived, isPlottableFnDef, type EvalContext } from './scope';
import { boxOutside, parametricBox, polarBox } from './math/bounds';
import { specNodes, type PointSpec } from './math/points';
import { PathBuilder, flattenOps, type Pt } from './geom/path';
import { getFrameSequence } from './frames/assets';
import { buildOdeInfo, familyGhosts, pruneOdeCaches, type Ghost, type OdeInfo, type SolvedGroup } from './ode/overlays';
import { groupLeader, groupView, phaseRange, PHASE_SAMPLES } from './ode/view';
import type { Entry, Viewport } from '../store/types';

export interface CurveResult {
  parsed: Parsed;
  curve: SampledCurve;
  error?: string;
  /** Referenced names that aren't defined anywhere — prompt the user to define them. */
  undefinedVars?: string[];
  /** Called functions that aren't recognised. */
  unknownFns?: string[];
  /** Marker coordinates for a 'points' entry. */
  points?: [number, number][];
  /** Shaded-region test + per-constraint boundaries for an 'inequality' entry. */
  inequality?: {
    test: (t: number, y: number) => boolean;
    boundaries: { segments: Point[][]; strict: boolean }[];
  };
  /** Current value of a derived entry (`b = 2a`). */
  value?: number;
  /** 'evenodd': fill all segments as ONE shape so nested contours become holes
   * (frame sequences). Otherwise each closed segment is filled on its own. */
  fillRule?: 'evenodd';
  /** How many copies a `for` repeat drew. */
  copies?: number;
  /** How many shapes (copies) were skipped because they lie entirely off-screen. */
  culled?: number;
  /** Per copy of a repeat: its slice of `curve.segments` / `points` and its
   * loop values — so colour expressions using `k` resolve per copy. */
  copyRanges?: CopyRange[];
  /** Smooth point paths: the exact path as ops (lib/geom/path, Script mode's
   * format) in data coordinates; `curve` holds its flattened polyline. */
  path?: number[];
  /** ODE qualitative view: phase plane, field, equilibria, extra solutions (lib/ode). */
  ode?: OdeInfo;
  /** Parameter-family ghost curves (a slider's `family` switch). */
  ghosts?: Ghost[];
  /** ODE: conditions used, solver, shown steps (lib/solver/odeGroup). */
  numerics?: OdeNumerics;
}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

export interface CopyRange {
  /** [start, end) into curve.segments. */
  seg: [number, number];
  /** [start, end) into points. */
  pts: [number, number];
  vars: Record<string, number>;
}

// Per-entry result cache: a curve is re-sampled only when one of its real inputs
// (expression, viewport, samples, the variable values it depends on, …) changes.
// During an animation or a single-slider drag this skips re-sampling every *other*
// curve — marching-squares (implicit/inequality) is the expensive one to avoid.
const RESULT_CACHE = new Map<string, { key: string; result: CurveResult }>();
// ODE integration is cached per coupling-group (keyed by the group's member ids).
const ODE_GROUP_CACHE = new Map<
  string,
  {
    key: string;
    curves: Map<string, SampledCurve>;
    errors: Map<string, string>;
    numerics: Map<string, OdeNumerics>;
    solved?: SolvedGroup;
  }
>();

/** Max total copies a `for` repeat may draw. */
export const MAX_COPIES = 2000;
/** Bounds of a per-entry `samples` override. */
export const MIN_SAMPLES = 8;
export const MAX_SAMPLES = 20000;

/** An entry's own sample count (clamped), or undefined for the defaults. */
export function entrySamples(entry: Entry): number | undefined {
  const n = entry.samples;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, n)));
}

/** The initial point comes from typed conditions or a boundary-value solve. */
function icLocked(n: OdeNumerics | undefined): boolean {
  return !!n && (n.typedT0 || n.typedIc.some(Boolean) || !!n.bvp);
}

function extractComponent(traj: Trajectory, idx: number): SampledCurve {
  const segments: Point[][] = [];
  for (const seg of traj) {
    let pts: Point[] = [];
    for (let i = 0; i < seg.ts.length; i++) {
      const p: Point = [seg.ts[i], seg.ys[i][idx]];
      // A repeated time is an impulse: this component jumps (new piece) or not (skip).
      if (i > 0 && seg.ts[i] === seg.ts[i - 1]) {
        if (p[1] === pts[pts.length - 1]?.[1]) continue;
        if (pts.length >= 2) segments.push(pts);
        pts = [];
      }
      pts.push(p);
    }
    if (pts.length >= 2) segments.push(pts);
  }
  return { segments };
}

function baseVar(symbol: string): string {
  return symbol.replace(/^D\d+_/, '');
}

/** Every expression node an entry evaluates (recursing into repeat bodies). */
export function nodesOf(parsed: Parsed): MathNode[] {
  switch (parsed.kind) {
    case 'function':
    case 'implicit':
    case 'fndef':
      return [parsed.node];
    case 'ode':
      return [
        parsed.node,
        ...(parsed.impulses ?? []).flatMap((p) => [p.arg, p.coef]),
        ...(parsed.conds ?? []).flatMap((c) => [c.at, c.value]),
      ];
    case 'condition':
      return parsed.conds.flatMap((c) => [c.at, c.value]);
    case 'points':
      return parsed.points.flatMap(specNodes);
    case 'pointvar':
      return [parsed.tNode, parsed.yNode];
    case 'polar':
      return [parsed.rNode];
    case 'inequality':
      return parsed.parts.map((p) => p.node);
    case 'parametric':
      return [parsed.xNode, parsed.yNode];
    case 'frames':
      return [parsed.indexNode];
    case 'layer':
      return parsed.args;
    case 'repeat':
      return [
        ...nodesOf(parsed.body),
        ...parsed.loops.flatMap((l) => [l.from, l.to, l.step].filter((n): n is MathNode => !!n)),
      ];
    default:
      return [];
  }
}

/** Names of all functions an entry calls. */
export function callsOf(parsed: Parsed): Set<string> {
  const out = new Set<string>();
  for (const n of nodesOf(parsed)) for (const f of calledFunctions(n)) out.add(f);
  return out;
}

/** Sample a polar curve r = f(θ) as the parametric (x, y) = (r·cosθ, r·sinθ)
 * polyline over θ ∈ [thetaMin, thetaMax]. Breaks the polyline where r is undefined. */
function samplePolar(
  rEval: { evaluate: (scope: object) => unknown },
  scope: Record<string, number>,
  thetaMin: number,
  thetaMax: number,
  n?: number,
): SampledCurve {
  const span = thetaMax - thetaMin;
  // ~720 samples per full turn, capped, so wide sweeps stay smooth but bounded.
  const N = n ?? Math.max(2, Math.min(8000, Math.round((Math.abs(span) / (Math.PI * 2)) * 720)));
  const ps = { ...scope } as Record<string, number>;
  const segments: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const th = thetaMin + (i / N) * span;
    ps['θ'] = th;
    ps.theta = th;
    let r: unknown;
    try {
      r = rEval.evaluate(ps);
    } catch {
      r = NaN;
    }
    if (typeof r === 'number' && Number.isFinite(r)) {
      cur.push([r * Math.cos(th), r * Math.sin(th)]);
    } else if (cur.length) {
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) segments.push(cur);
  return { segments };
}

/**
 * Sample a parametric curve (x(t), y(t)) over t ∈ [tMin, tMax]. ~480 samples per
 * 2π of parameter (at least 200), breaking where either coordinate is undefined.
 */
export function sampleParametric(
  xEval: { evaluate: (scope: object) => unknown },
  yEval: { evaluate: (scope: object) => unknown },
  scope: Record<string, number>,
  tMin: number,
  tMax: number,
  n?: number,
): SampledCurve {
  const span = tMax - tMin;
  if (!Number.isFinite(span)) return EMPTY_CURVE;
  const N = n ?? Math.max(200, Math.min(8000, Math.round((Math.abs(span) / (Math.PI * 2)) * 480)));
  const ps = { ...scope } as Record<string, number>;
  const segments: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i <= N; i++) {
    ps.t = tMin + (i / N) * span;
    let x: unknown;
    let y: unknown;
    try {
      x = xEval.evaluate(ps);
      y = yEval.evaluate(ps);
    } catch {
      x = NaN;
    }
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      cur.push([x, y]);
    } else if (cur.length) {
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) segments.push(cur);
  return { segments };
}

/**
 * Every combination of loop values (cartesian product, in order). A loop's
 * bounds may reference globals and earlier loops. Throws past MAX_COPIES.
 */
export function expandLoops(loops: LoopSpec[], scope: Record<string, number>): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}];
  for (const loop of loops) {
    const next: Record<string, number>[] = [];
    for (const combo of combos) {
      const sc = { ...scope, ...combo };
      const num = (n: MathNode | undefined, dflt: number) => {
        if (!n) return dflt;
        const v = compileNode(n).evaluate(sc);
        if (typeof v !== 'number') throw new Error('Loop bounds must be numbers');
        return v;
      };
      const values = loopValues(num(loop.from, 0), num(loop.to, 0), num(loop.step, 1), MAX_COPIES + 1);
      for (const v of values) {
        next.push({ ...combo, [loop.name]: v });
        if (next.length > MAX_COPIES) throw new Error(`Too many copies (max ${MAX_COPIES})`);
      }
    }
    combos = next;
  }
  return combos;
}

interface SampleCtx {
  entry: Entry;
  viewport: Viewport;
  samples: number;
  pointScope: Map<string, [number, number]>;
  /** Callable ODE solutions (lib/solver/solutions). */
  solNames: Set<string>;
  /** The entry's own `samples` override, if any. */
  own?: number;
  /** Data-space margin around the viewport for off-screen culling; null = never cull. */
  cullMargin: number | null;
}

/** Margin (data units) a shape must clear the viewport by to be culled: room for
 * its stroke and some slack, so culling can never clip anything visible. */
function cullMarginFor(entry: Entry, viewport: Viewport, samples: number): number | null {
  // Shapes on a transformed layer are moved at draw time: never cull those.
  if (entry.layer) return null;
  const span = Math.max(viewport.tMax - viewport.tMin, viewport.yMax - viewport.yMin);
  const unitsPerPx = (viewport.tMax - viewport.tMin) / Math.max(1, samples / 1.5);
  // Half the widest stroke (20 px), glow / blur spread, plus slack.
  const px = 10 + (entry.glow ?? 0) * 2 + (entry.blur ?? 0) * 2 + 8;
  return 0.02 * span + px * unitsPerPx;
}

const CULLED: SampledCurve = { segments: [] };

type Drawable = Extract<
  Parsed,
  { kind: 'function' | 'implicit' | 'polar' | 'parametric' | 'inequality' | 'points' | 'frames' }
>;

/** Sample one drawable entry body against a scope (throws on evaluation errors). */
function sampleDrawable(parsed: Drawable, scope: Record<string, number>, ctx: SampleCtx): CurveResult {
  const { entry, viewport, samples, pointScope } = ctx;
  const { tMin, tMax } = viewport;
  switch (parsed.kind) {
    case 'function': {
      const curve = sampleFunction(compileNode(parsed.node), scope, {
        tMin,
        tMax,
        samples: ctx.own ?? samples,
        yMin: viewport.yMin,
        yMax: viewport.yMax,
      });
      return { parsed, curve };
    }
    case 'implicit':
      return {
        parsed,
        curve: sampleImplicit(compileNode(shieldCalls(parsed.node, ctx.solNames)), scope, viewport, gridFor(ctx)),
      };
    case 'polar': {
      const tMinP = entry.thetaMin ?? 0;
      const tMaxP = entry.thetaMax ?? Math.PI * 2;
      if (ctx.cullMargin !== null && boxOutside(polarBox(parsed.rNode, scope, tMinP, tMaxP), viewport, ctx.cullMargin)) {
        return { parsed, curve: CULLED, culled: 1 };
      }
      return { parsed, curve: samplePolar(compileNode(parsed.rNode), scope, tMinP, tMaxP, ctx.own) };
    }
    case 'parametric': {
      const t0 = entry.thetaMin ?? 0;
      const t1 = entry.thetaMax ?? Math.PI * 2;
      // Skip shapes whose guaranteed bounds miss the view (interval arithmetic:
      // never culls anything visible; unbounded expressions are never culled).
      if (
        ctx.cullMargin !== null &&
        Number.isFinite(t1 - t0) &&
        boxOutside(parametricBox(parsed.xNode, parsed.yNode, scope, t0, t1), viewport, ctx.cullMargin)
      ) {
        return { parsed, curve: CULLED, culled: 1 };
      }
      return {
        parsed,
        curve: sampleParametric(compileNode(parsed.xNode), compileNode(parsed.yNode), scope, t0, t1, ctx.own),
      };
    }
    case 'frames': {
      const seq = getFrameSequence(entry.frames);
      if (seq instanceof Error) throw seq;
      const idx = compileNode(parsed.indexNode).evaluate(scope);
      if (typeof idx !== 'number') throw new Error('Frame index must be a number');
      return { parsed, curve: { segments: seq.frameInData(idx) }, fillRule: 'evenodd' };
    }
    case 'inequality':
      return sampleInequality(parsed, scope, entry, viewport, ctx);
    case 'points': {
      // Reinterpret a single (A, B) as a line when both are point-variables.
      let specs = parsed.points;
      let polyline = parsed.polyline;
      if (!polyline && specs.length === 1) {
        const sp = specs[0];
        if (sp.xSym && pointScope.has(sp.xSym) && sp.ySym && pointScope.has(sp.ySym)) {
          specs = [{ ref: sp.xSym }, { ref: sp.ySym }];
          polyline = true;
        }
      }
      if (parsed.smooth) return samplePath(parsed, scope, ctx);
      const coords: [number, number][] = [];
      for (const sp of specs) {
        if (sp.ref) {
          const c = pointScope.get(sp.ref);
          if (c) coords.push(c);
        } else if (sp.tNode && sp.yNode) {
          const t = compileNode(sp.tNode).evaluate(scope);
          const y = compileNode(sp.yNode).evaluate(scope);
          if (typeof t === 'number' && typeof y === 'number' && Number.isFinite(t) && Number.isFinite(y)) {
            coords.push([t, y]);
          }
        }
      }
      const curve = polyline && coords.length >= 2 ? { segments: [coords] } : EMPTY_CURVE;
      return { parsed, curve, points: coords };
    }
  }
}

/** Marching-squares grid for an entry with its own `samples` (cells across x). */
function gridFor(ctx: SampleCtx): { cellsX: number; cellsY: number } | undefined {
  if (ctx.own === undefined) return undefined;
  const { viewport: v } = ctx;
  const cellsX = Math.min(600, ctx.own);
  const aspect = (v.yMax - v.yMin) / Math.max(1e-12, v.tMax - v.tMin);
  return { cellsX, cellsY: Math.max(8, Math.min(600, Math.round(cellsX * aspect))) };
}

/** Evaluate one point spec (a literal point or a point-variable reference). */
function evalPoint(sp: PointSpec, scope: Record<string, number>, pointScope: Map<string, [number, number]>): Pt | null {
  if (sp.ref) return pointScope.get(sp.ref) ?? null;
  if (!sp.tNode || !sp.yNode) return null;
  const t = compileNode(sp.tNode).evaluate(scope);
  const y = compileNode(sp.yNode).evaluate(scope);
  return typeof t === 'number' && typeof y === 'number' && Number.isFinite(t) && Number.isFinite(y) ? [t, y] : null;
}

/**
 * A point path with smooth pieces: plain points are corners, `spline(…)` runs a
 * centripetal Catmull-Rom curve through its points, `bezier(…)` and `arc(…)`
 * continue from the previous point. Built as path ops (lib/geom/path, Script
 * mode's format), then flattened to one polyline (~2 px per piece, or the
 * entry's own `samples` per cubic). `points` are the corners only (no dots).
 */
function samplePath(
  parsed: Extract<Parsed, { kind: 'points' }>,
  scope: Record<string, number>,
  ctx: SampleCtx,
): CurveResult {
  const { pointScope, viewport } = ctx;
  const P = (sp: PointSpec): Pt => {
    const p = evalPoint(sp, scope, pointScope);
    if (!p) throw new Error('A path point is undefined');
    return p;
  };
  const b = new PathBuilder();
  const corners: [number, number][] = [];
  const specs = parsed.points;
  // A single top-level spline whose last point equals its first is a closed loop.
  const lone = specs.length === 1 && specs[0].seg?.kind === 'spline';
  specs.forEach((sp, i) => {
    const seg = sp.seg;
    if (!seg) {
      const p = P(sp);
      b.lineTo(p);
      corners.push(p);
      return;
    }
    if (seg.kind === 'spline') {
      const pts = seg.points.map(P);
      // Neighbouring corners shape the end tangents so the curve leaves and
      // joins the straight parts naturally.
      const prevSpec = specs[i - 1];
      const nextSpec = specs[i + 1];
      const before = prevSpec && !prevSpec.seg && specs[i - 2] && !specs[i - 2].seg ? P(specs[i - 2]) : undefined;
      const after = nextSpec && !nextSpec.seg ? P(nextSpec) : undefined;
      b.splineThrough(pts, { closed: lone, before, after });
    } else if (seg.kind === 'bezier') {
      const pts = seg.points.map(P);
      if (pts.length === 3) b.cubicTo(pts[0], pts[1], pts[2]);
      else b.quadTo(pts[0], pts[1]);
    } else {
      const angle = compileNode(seg.angle).evaluate(scope);
      if (typeof angle !== 'number') throw new Error('arc angle must be a number');
      b.arcAround(P(seg.center), angle);
    }
  });
  const unitsPerPx = (viewport.tMax - viewport.tMin) / Math.max(1, ctx.samples / 1.5);
  const segments = flattenOps(b.ops, unitsPerPx * 2, ctx.own);
  return { parsed, curve: { segments }, points: corners, path: b.ops };
}

function sampleInequality(
  parsed: Extract<Parsed, { kind: 'inequality' }>,
  scope: Record<string, number>,
  entry: Entry,
  viewport: Viewport,
  ctx: SampleCtx,
): CurveResult {
  // Each constraint contributes a boundary curve; the region is their AND.
  const TWO_PI = Math.PI * 2;
  const thMin = entry.thetaMin ?? 0;
  const thMax = entry.thetaMax ?? TWO_PI;
  const parts = parsed.parts.map((p) => ({
    // (y is a coordinate here, so solution calls y(…) go through their alias.)
    ev: compileNode(shieldCalls(p.node, ctx.solNames)),
    op: p.op,
    // A polar part references r or θ — its θ is the swept angle, not a position.
    polar: hasSymbol(p.node, 'r') || hasSymbol(p.node, 'θ') || hasSymbol(p.node, 'theta'),
  }));
  const anyPolar = parts.some((p) => p.polar);
  const sc: Record<string, number> = { ...scope };
  const okOp = (v: unknown, op: (typeof parts)[number]['op']): boolean =>
    typeof v === 'number' &&
    Number.isFinite(v) &&
    (op === '<' ? v < 0 : op === '<=' ? v <= 0 : op === '>' ? v > 0 : v >= 0);

  // Region test. For polar constraints the angle is swept, so a point is inside
  // if ANY θ ≡ φ (mod 2π) within [thMin, thMax] satisfies every part — this both
  // clips to a θ-sector and lets a spiral (r < 2θ) keep filling for wider ranges.
  const test = (t: number, y: number): boolean => {
    sc.t = t;
    sc.y = y;
    if (!anyPolar) {
      for (const p of parts) {
        let v: unknown;
        try {
          v = p.ev.evaluate(sc);
        } catch {
          return false;
        }
        if (!okOp(v, p.op)) return false;
      }
      return true;
    }
    sc.r = Math.hypot(t, y);
    let phi = Math.atan2(y, t);
    if (phi < 0) phi += TWO_PI;
    for (let k = Math.ceil((thMin - phi) / TWO_PI - 1e-9); ; k++) {
      const th = phi + TWO_PI * k;
      if (th > thMax + 1e-9) break;
      if (th < thMin - 1e-9) continue;
      sc['θ'] = th;
      sc.theta = th;
      let allOk = true;
      for (const p of parts) {
        let v: unknown;
        try {
          v = p.ev.evaluate(sc);
        } catch {
          v = NaN;
        }
        if (!okOp(v, p.op)) {
          allOk = false;
          break;
        }
      }
      if (allOk) return true;
    }
    return false;
  };

  // Boundaries: a polar part (r OP f(θ), linear in r) is drawn as a true polar
  // curve over [thMin, thMax] so it spirals out across turns; other parts use
  // marching squares.
  const polarScope: Record<string, number> = { ...scope };
  const samplePolarBoundary = (ev: ReturnType<typeof compileNode>): Point[][] => {
    const span = thMax - thMin;
    const N = ctx.own ?? Math.max(2, Math.min(12000, Math.round((Math.abs(span) / TWO_PI) * 720)));
    const segs: Point[][] = [];
    let cur: Point[] = [];
    const at = (th: number, r: number): number => {
      polarScope['θ'] = th;
      polarScope.theta = th;
      polarScope.r = r;
      try {
        const v = ev.evaluate(polarScope);
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
    for (let i = 0; i <= N; i++) {
      const th = thMin + (i / N) * span;
      // Solve the (assumed linear-in-r) constraint f(r,θ)=0 for r.
      const b = at(th, 0);
      const a = at(th, 1) - b;
      const r = a !== 0 ? -b / a : NaN;
      if (Number.isFinite(r) && r >= 0) {
        cur.push([r * Math.cos(th), r * Math.sin(th)]);
      } else if (cur.length >= 2) {
        segs.push(cur);
        cur = [];
      } else {
        cur = [];
      }
    }
    if (cur.length >= 2) segs.push(cur);
    return segs;
  };
  const boundaries = parts.map((p) => ({
    segments: p.polar
      ? samplePolarBoundary(p.ev)
      : sampleImplicit(p.ev as unknown as Parameters<typeof sampleImplicit>[0], scope, viewport, gridFor(ctx)).segments,
    strict: p.op === '<' || p.op === '>',
  }));
  return {
    parsed,
    curve: { segments: boundaries.flatMap((b) => b.segments) },
    inequality: { test, boundaries },
  };
}

/** Draw a repeat's body once per loop combination and merge the copies. */
function sampleRepeat(
  parsed: Extract<Parsed, { kind: 'repeat' }>,
  scope: Record<string, number>,
  ctx: SampleCtx,
): CurveResult {
  const combos = expandLoops(parsed.loops, scope);
  const body = parsed.body as Drawable;
  const segments: Point[][] = [];
  const points: [number, number][] = [];
  const tests: ((t: number, y: number) => boolean)[] = [];
  const boundaries: { segments: Point[][]; strict: boolean }[] = [];
  let culled = 0;
  const copyRanges: CopyRange[] = [];
  for (const combo of combos) {
    const r = sampleDrawable(body, { ...scope, ...combo }, ctx);
    if (r.culled) culled += r.culled;
    const s0 = segments.length;
    const p0 = points.length;
    for (const s of r.curve.segments) segments.push(s);
    if (r.points) for (const p of r.points) points.push(p);
    copyRanges.push({ seg: [s0, segments.length], pts: [p0, points.length], vars: combo });
    if (r.inequality) {
      tests.push(r.inequality.test);
      boundaries.push(...r.inequality.boundaries);
    }
  }
  const out: CurveResult = { parsed, curve: { segments }, copies: combos.length, copyRanges };
  if (culled) out.culled = culled;
  if (body.kind === 'points') out.points = points;
  // A repeated inequality is the UNION of its copies.
  if (body.kind === 'inequality') {
    out.inequality = { test: (t, y) => tests.some((f) => f(t, y)), boundaries };
  }
  return out;
}

export function computeAll(
  entries: Entry[],
  viewport: Viewport,
  samples = 1500,
): Map<string, CurveResult> {
  const { tMin, tMax } = viewport;
  const results = new Map<string, CurveResult>();
  const parsedList = entries.map((e) => ({ entry: e, parsed: parseEntry(e.raw) }));

  // Defined names: variables, derived values, user functions (+ ODE dep vars).
  // (Fixed-step ODE solutions called as y(T) step like the drawn curve.)
  const ectx: EvalContext = buildEvalContext(parsedList, { odeStep: (tMax - tMin) / samples });
  const { scope, varNames, derivedNames, fnNames, solutions } = ectx;
  const solNames = solutions.names;
  const callable = (f: string) => KNOWN_FUNCTIONS.has(f) || fnNames.has(f) || solNames.has(f);
  const callsSolution = (p: Parsed) => solNames.size > 0 && [...callsOf(p)].some((f) => solNames.has(f));
  const depVars = new Set<string>();
  for (const { parsed } of parsedList) if (parsed.kind === 'ode') depVars.add(parsed.depVar);
  const valueNames = new Set([...varNames, ...derivedNames]);
  // ODE notation (lib/solver/odeGroup): `y' = x·y` reads x as the independent
  // variable unless an ODE or slider defines x; conditions typed on own rows.
  const condRows = applyOdeNotation(parsedList, depVars, valueNames);
  const callsUser = (p: Parsed) => fnNames.size > 0 && [...callsOf(p)].some((f) => fnNames.has(f));

  // Point-valued variables (A = (x, y)) resolved to coordinates.
  const pointScope = new Map<string, [number, number]>();
  const pointvarNames = new Set<string>();
  for (const { parsed } of parsedList) {
    if (parsed.kind !== 'pointvar') continue;
    // Never evaluate calls to unknown functions (links are untrusted input).
    if ([...callsOf(parsed)].some((f) => !callable(f))) continue;
    pointvarNames.add(parsed.name);
    try {
      const t = compileNode(parsed.tNode).evaluate(scope);
      const y = compileNode(parsed.yNode).evaluate(scope);
      if (typeof t === 'number' && typeof y === 'number' && Number.isFinite(t) && Number.isFinite(y)) {
        pointScope.set(parsed.name, [t, y]);
      }
    } catch {
      /* unresolved; left out of pointScope */
    }
  }

  const loneSymbol = (node: { type?: string; name?: string }): string | undefined =>
    node.type === 'SymbolNode' ? node.name : undefined;

  // ODE coupling groups.
  const odes = parsedList.filter(
    (p): p is { entry: Entry; parsed: OdeParsed } => p.parsed.kind === 'ode',
  );
  const groups = odeGroups(odes.map((o) => o.parsed));

  const odeCurve = new Map<string, SampledCurve>();
  const odeError = new Map<string, string>();
  const solvedGroups: SolvedGroup[] = [];
  const odeNumerics = new Map<string, OdeNumerics>();
  for (const idxs of groups) {
    const members = idxs.map((i) => odes[i]);
    // An equation reading a solution value (y'' = −y + y(1)) is a cycle: refused.
    const eqCalls = (p: OdeParsed) =>
      [p.node, ...(p.impulses ?? []).flatMap((q) => [q.arg, q.coef])].flatMap((n) => [...calledFunctions(n)]);
    if (solNames.size && members.some((m) => eqCalls(m.parsed).some((f) => solNames.has(f)))) {
      for (const m of members) odeError.set(m.entry.id, SOLUTION_IN_EQUATION);
      ODE_GROUP_CACHE.delete(members.map((m) => m.entry.id).sort().join('+'));
      continue;
    }
    // Cache the (expensive) RK4 integration: a group re-integrates only when a
    // member's expression / IVP / a referenced variable / the t-range changes.
    const cacheId = members.map((m) => m.entry.id).sort().join('+');
    const groupDeps = new Set<string>();
    for (const m of members) for (const d of m.parsed.deps) groupDeps.add(baseVar(d));
    const depSig = [...groupDeps]
      .map((d) => (d in scope ? scope[d] : 'u'))
      .join(',');
    const memberSig = members
      .map((m) => `${m.entry.id}:${m.entry.raw}:${m.entry.t0 ?? ''}:${m.entry.ic?.join('_') ?? ''}:${m.parsed.indep ?? ''}`)
      .join(';');
    const fnSig = members.some((m) => callsUser(m.parsed)) ? ectx.fnKey : '';
    // Typed conditions, boundary mode, solver and shown steps (resolved numbers).
    const setup = resolveGroupSetup(members, condRows, scope, entries, fnNames, solNames);
    // Phase plane: integrate a fixed window around t0 (the axes are state
    // variables, so the viewport's x-range isn't a time range).
    const view = groupView(
      members.map((m) => m.entry),
      members.flatMap((m) => m.parsed.stateSymbols),
    );
    const range = view.phase ? phaseRange(setup.bvp ? setup.bvp.a : setup.t0) : { tMin, tMax };
    const steps = view.phase ? PHASE_SAMPLES : samples;
    const gkey = `${memberSig}|${depSig}|${range.tMin}|${range.tMax}|${steps}|${fnSig}|${setup.key}|${view.key}`;
    const cached = ODE_GROUP_CACHE.get(cacheId);
    if (cached && cached.key === gkey) {
      for (const [id, c] of cached.curves) odeCurve.set(id, c);
      for (const [id, e] of cached.errors) odeError.set(id, e);
      for (const [id, n] of cached.numerics) odeNumerics.set(id, n);
      // Non-key fields (extra solutions, field switch) are read from the live entries.
      if (cached.solved) {
        solvedGroups.push({
          ...cached.solved,
          entries: members.map((m) => m.entry),
          leaderId: groupLeader(members.map((m) => m.entry), entries).id,
        });
      }
      continue;
    }
    let solved: SolvedGroup | undefined;
    const curves = new Map<string, SampledCurve>();
    const errors = new Map<string, string>();
    const numerics = new Map<string, OdeNumerics>();
    try {
      const system = buildSystem(members.map((m) => m.parsed), scope);
      const run = whileSolving(() =>
        runGroup(system, members, setup, scope, { tMin: range.tMin, tMax: range.tMax, samples: steps }),
      );
      system.blocks.forEach((block, b) => {
        curves.set(members[b].entry.id, extractComponent(run.traj, block.offset));
        numerics.set(members[b].entry.id, run.numerics[b]);
      });
      // The initial point actually used (typed conditions / shooting applied).
      const y0 = run.numerics.flatMap((n) => n.ic);
      solved = {
        entries: members.map((m) => m.entry),
        parsed: members.map((m) => m.parsed),
        system,
        traj: run.traj,
        t0: run.numerics[0]?.t0 ?? setup.t0,
        y0,
        method: setup.method,
        forcing: forcing(system, members, scope),
        leaderId: groupLeader(members.map((m) => m.entry), entries).id,
        view,
        range,
        steps,
        rawSig: members.map((m) => `${m.entry.id}:${m.entry.raw}`).join(';'),
        depSig: `${depSig}|${fnSig}`,
        deps: [...groupDeps],
        callsUser: !!fnSig,
        scope,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const i of idxs) errors.set(odes[i].entry.id, msg);
    }
    for (const [id, c] of curves) odeCurve.set(id, c);
    for (const [id, e] of errors) odeError.set(id, e);
    for (const [id, n] of numerics) odeNumerics.set(id, n);
    ODE_GROUP_CACHE.set(cacheId, { key: gkey, curves, errors, numerics, solved });
    if (solved) solvedGroups.push(solved);
  }
  // Phase plane, field, equilibria, extra solutions (cached in lib/ode/overlays).
  const odeInfo = buildOdeInfo(solvedGroups, { entries, viewport, samples });

  // The set of names defined anywhere folds into each entry's cache key, so a
  // definition appearing/disappearing elsewhere invalidates the cached curve.
  const definedKey =
    [...varNames].sort().join(',') +
    ';' +
    [...depVars].sort().join(',') +
    ';' +
    [...pointvarNames].sort().join(',') +
    ';' +
    [...derivedNames].sort().join(',') +
    ';' +
    [...fnNames].sort().join(',');
  // Serialise the values an entry depends on (variables, and point-variable coords).
  const depKey = (deps: string[]): string =>
    deps
      .map((d) => {
        if (d in scope && typeof scope[d] === 'number') return scope[d];
        const p = pointScope.get(d);
        return p ? `${p[0]}_${p[1]}` : 'u';
      })
      .join(',');

  const seenFn = new Set<string>();
  for (const { entry, parsed } of parsedList) {
    const computeOne = (): CurveResult => {
      if (parsed.kind === 'empty' || parsed.kind === 'variable') {
        return { parsed, curve: EMPTY_CURVE };
      }
      if (parsed.kind === 'error') {
        return { parsed, curve: EMPTY_CURVE, error: parsed.message };
      }

      // A bare reference to a point-valued variable (parsed as a function `y = A`).
      let barePoint: string | undefined;
      if (parsed.kind === 'function') {
        const nm = loneSymbol(parsed.node as unknown as { type?: string; name?: string });
        if (nm && pointvarNames.has(nm)) barePoint = nm;
      }

      // Validation common to plottable kinds.
      const unknownFns = [...callsOf(parsed)].filter((f) => !callable(f)).map(solutionLabel);
      let defined: Set<string>;
      if (parsed.kind === 'ode') defined = new Set([...valueNames, ...depVars]);
      else if (
        parsed.kind === 'points' ||
        (parsed.kind === 'repeat' && parsed.body.kind === 'points')
      ) {
        defined = new Set([...valueNames, ...pointvarNames]);
      } else defined = valueNames;
      const undefinedVars = barePoint ? [] : parsed.deps.filter((d) => !defined.has(d));

      if (unknownFns.length) {
        return {
          parsed,
          curve: EMPTY_CURVE,
          unknownFns,
          error: `Unknown function: ${unknownFns.join(', ')}`,
        };
      }
      if (undefinedVars.length) {
        return { parsed, curve: EMPTY_CURVE, undefinedVars };
      }
      // A call of an ODE solution whose equation can't be solved: say why.
      if (parsed.kind !== 'ode' && parsed.kind !== 'condition' && callsSolution(parsed)) {
        const err = solutions.errorFor(callsOf(parsed));
        if (err) return { parsed, curve: EMPTY_CURVE, error: err };
      }

      // Derived values and function definitions draw nothing (unless a one-
      // parameter f(x) — plotted like Desmos).
      if (!barePoint && isDerived(parsed)) {
        const err = ectx.derivedErrors.get(entry.id);
        if (err) return { parsed, curve: EMPTY_CURVE, error: err };
        return { parsed, curve: EMPTY_CURVE, value: ectx.derivedValues.get(entry.id) };
      }
      if (parsed.kind === 'fndef') {
        if (seenFn.has(parsed.name) || varNames.has(parsed.name)) {
          return { parsed, curve: EMPTY_CURVE, error: `${parsed.name} is already defined` };
        }
        seenFn.add(parsed.name);
        if (!entry.visible || !isPlottableFnDef(parsed)) return { parsed, curve: EMPTY_CURVE };
        const fn = scope[parsed.name] as unknown as (v: number) => unknown;
        const ev = { evaluate: (sc: { t: number }) => fn(sc.t) };
        const curve = sampleFunction(ev as unknown as ReturnType<typeof compileNode>, scope, {
          tMin,
          tMax,
          samples: entrySamples(entry) ?? samples,
          yMin: viewport.yMin,
          yMax: viewport.yMax,
        });
        return { parsed, curve };
      }

      if (parsed.kind === 'condition') {
        // Conditions draw nothing; they set the ODE's initial / boundary values.
        if (!depVars.has(parsed.depVar)) {
          return { parsed, curve: EMPTY_CURVE, error: `No equation for ${parsed.depVar} yet: add a row like ${parsed.depVar}′ = …` };
        }
        return { parsed, curve: EMPTY_CURVE };
      }

      if (!entry.visible || parsed.kind === 'layer') {
        // Layers draw nothing themselves; PlotCanvas evaluates their transform.
        return { parsed, curve: EMPTY_CURVE };
      }

      try {
        if (barePoint) {
          const coord = pointScope.get(barePoint);
          return { parsed, curve: EMPTY_CURVE, points: coord ? [coord] : [] };
        }
        if (parsed.kind === 'pointvar') {
          const coord = pointScope.get(parsed.name);
          return { parsed, curve: EMPTY_CURVE, points: coord ? [coord] : [] };
        }
        if (parsed.kind === 'ode') {
          const err = odeError.get(entry.id);
          if (err) return { parsed, curve: EMPTY_CURVE, error: err };
          const numerics = odeNumerics.get(entry.id);
          let ode = odeInfo.get(entry.id);
          // Typed conditions / boundary values fix the start: no draggable IC ring
          // (a drag would write ic that the typed conditions override).
          if (ode?.ic && ode.groupIds.some((id) => icLocked(odeNumerics.get(id)))) ode = { ...ode, ic: undefined };
          return {
            parsed,
            curve: odeCurve.get(entry.id) ?? EMPTY_CURVE,
            ...(numerics ? { numerics } : {}),
            ...(ode ? { ode } : {}),
          };
        }
        const sctx: SampleCtx = {
          entry,
          viewport,
          samples,
          pointScope,
          solNames,
          own: entrySamples(entry),
          cullMargin: cullMarginFor(entry, viewport, samples),
        };
        if (parsed.kind === 'repeat') return sampleRepeat(parsed, scope, sctx);
        return sampleDrawable(parsed as Drawable, scope, sctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { parsed, curve: EMPTY_CURVE, error: msg };
      }
    };

    // Re-sample only when a real input changed. Cheap kinds (points, ODE reads,
    // empty/var/error) aren't cached — their loop body is already trivial.
    const cacheable =
      (parsed.kind === 'function' && !isDerived(parsed)) ||
      parsed.kind === 'implicit' ||
      parsed.kind === 'polar' ||
      parsed.kind === 'inequality' ||
      parsed.kind === 'parametric' ||
      parsed.kind === 'repeat' ||
      parsed.kind === 'frames';
    if (cacheable) {
      const key =
        `${parsed.kind}|${entry.raw}|${entry.visible ? 1 : 0}|` +
        `${tMin},${tMax},${viewport.yMin},${viewport.yMax}|${samples}|` +
        `${entry.thetaMin ?? ''},${entry.thetaMax ?? ''}|${entry.samples ?? ''}|${entry.layer ?? ''}|` +
        `${entry.glow ?? ''},${entry.blur ?? ''}|${depKey(parsed.deps)}|${definedKey}|` +
        `${callsUser(parsed) ? ectx.fnKey : ''}|${parsed.kind === 'frames' ? entry.frames ?? '' : ''}|` +
        // ODE solutions it calls (y(t)^2): their group's equations, values, conditions, solver.
        `${callsSolution(parsed) ? solutions.keyFor(callsOf(parsed)) : ''}`;
      const hit = RESULT_CACHE.get(entry.id);
      if (hit && hit.key === key) {
        results.set(entry.id, hit.result);
        continue;
      }
      const result = computeOne();
      RESULT_CACHE.set(entry.id, { key, result });
      results.set(entry.id, result);
    } else {
      results.set(entry.id, computeOne());
    }
  }

  // Parameter families: ghost curves for sliders with `family` on.
  if (parsedList.some((p) => p.entry.family && p.parsed.kind === 'variable')) {
    const ghosts = familyGhosts({
      parsedList,
      ectx,
      groups: solvedGroups,
      viewport,
      samples,
      definedKey,
      ownSamples: entrySamples,
      drawable: (id) => {
        const r = results.get(id);
        return !!r && !r.error && !r.undefinedVars?.length && !r.unknownFns?.length;
      },
    });
    for (const [id, list] of ghosts) {
      const r = results.get(id);
      if (r) results.set(id, { ...r, ghosts: list });
    }
  }

  // Drop cache slots for entries that no longer exist, keeping the maps bounded.
  const liveIds = new Set(entries.map((e) => e.id));
  pruneOdeCaches(liveIds);
  for (const id of [...RESULT_CACHE.keys()]) if (!liveIds.has(id)) RESULT_CACHE.delete(id);
  for (const gid of [...ODE_GROUP_CACHE.keys()]) {
    if (gid.split('+').some((id) => !liveIds.has(id))) ODE_GROUP_CACHE.delete(gid);
  }

  return results;
}
