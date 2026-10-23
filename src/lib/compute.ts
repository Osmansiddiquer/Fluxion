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
import { integrateSystem, type Trajectory } from './solver/integrate';
import { sampleFunction } from './solver/sample';
import { sampleImplicit } from './solver/implicit';
import { EMPTY_CURVE, type Point, type SampledCurve } from './solver/curve';
import { buildEvalContext, isDerived, isPlottableFnDef, type EvalContext } from './scope';
import { getFrameSequence } from './frames/assets';
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
}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

// Per-entry result cache: a curve is re-sampled only when one of its real inputs
// (expression, viewport, samples, the variable values it depends on, …) changes.
// During an animation or a single-slider drag this skips re-sampling every *other*
// curve — marching-squares (implicit/inequality) is the expensive one to avoid.
const RESULT_CACHE = new Map<string, { key: string; result: CurveResult }>();
// ODE integration is cached per coupling-group (keyed by the group's member ids).
const ODE_GROUP_CACHE = new Map<
  string,
  { key: string; curves: Map<string, SampledCurve>; errors: Map<string, string> }
>();

/** Max total copies a `for` repeat may draw. */
export const MAX_COPIES = 2000;

function resolveIC(ic: number[] | undefined, order: number): number[] {
  const out = new Array<number>(order).fill(0);
  out[0] = 1;
  if (ic) for (let i = 0; i < order; i++) if (i < ic.length && Number.isFinite(ic[i])) out[i] = ic[i];
  return out;
}

function extractComponent(traj: Trajectory, idx: number): SampledCurve {
  const segments: Point[][] = [];
  for (const seg of traj) {
    const pts: Point[] = new Array(seg.ts.length);
    for (let i = 0; i < seg.ts.length; i++) pts[i] = [seg.ts[i], seg.ys[i][idx]];
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
    case 'ode':
    case 'implicit':
    case 'fndef':
      return [parsed.node];
    case 'points':
      return parsed.points.flatMap((p) => [p.tNode, p.yNode].filter((n): n is MathNode => !!n));
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
): SampledCurve {
  const span = thetaMax - thetaMin;
  // ~720 samples per full turn, capped, so wide sweeps stay smooth but bounded.
  const N = Math.max(2, Math.min(8000, Math.round((Math.abs(span) / (Math.PI * 2)) * 720)));
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
): SampledCurve {
  const span = tMax - tMin;
  if (!Number.isFinite(span)) return EMPTY_CURVE;
  const N = Math.max(200, Math.min(8000, Math.round((Math.abs(span) / (Math.PI * 2)) * 480)));
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
}

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
        samples,
        yMin: viewport.yMin,
        yMax: viewport.yMax,
      });
      return { parsed, curve };
    }
    case 'implicit':
      return { parsed, curve: sampleImplicit(compileNode(parsed.node), scope, viewport) };
    case 'polar': {
      const tMinP = entry.thetaMin ?? 0;
      const tMaxP = entry.thetaMax ?? Math.PI * 2;
      return { parsed, curve: samplePolar(compileNode(parsed.rNode), scope, tMinP, tMaxP) };
    }
    case 'parametric': {
      const t0 = entry.thetaMin ?? 0;
      const t1 = entry.thetaMax ?? Math.PI * 2;
      return {
        parsed,
        curve: sampleParametric(compileNode(parsed.xNode), compileNode(parsed.yNode), scope, t0, t1),
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
      return sampleInequality(parsed, scope, entry, viewport);
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

function sampleInequality(
  parsed: Extract<Parsed, { kind: 'inequality' }>,
  scope: Record<string, number>,
  entry: Entry,
  viewport: Viewport,
): CurveResult {
  // Each constraint contributes a boundary curve; the region is their AND.
  const TWO_PI = Math.PI * 2;
  const thMin = entry.thetaMin ?? 0;
  const thMax = entry.thetaMax ?? TWO_PI;
  const parts = parsed.parts.map((p) => ({
    ev: compileNode(p.node),
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
    const N = Math.max(2, Math.min(12000, Math.round((Math.abs(span) / TWO_PI) * 720)));
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
      : sampleImplicit(p.ev as unknown as Parameters<typeof sampleImplicit>[0], scope, viewport).segments,
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
  for (const combo of combos) {
    const r = sampleDrawable(body, { ...scope, ...combo }, ctx);
    for (const s of r.curve.segments) segments.push(s);
    if (r.points) for (const p of r.points) points.push(p);
    if (r.inequality) {
      tests.push(r.inequality.test);
      boundaries.push(...r.inequality.boundaries);
    }
  }
  const out: CurveResult = { parsed, curve: { segments }, copies: combos.length };
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
  const ectx: EvalContext = buildEvalContext(parsedList);
  const { scope, varNames, derivedNames, fnNames } = ectx;
  const depVars = new Set<string>();
  for (const { parsed } of parsedList) if (parsed.kind === 'ode') depVars.add(parsed.depVar);
  const valueNames = new Set([...varNames, ...derivedNames]);
  const callsUser = (p: Parsed) => fnNames.size > 0 && [...callsOf(p)].some((f) => fnNames.has(f));

  // Point-valued variables (A = (x, y)) resolved to coordinates.
  const pointScope = new Map<string, [number, number]>();
  const pointvarNames = new Set<string>();
  for (const { parsed } of parsedList) {
    if (parsed.kind !== 'pointvar') continue;
    // Never evaluate calls to unknown functions (links are untrusted input).
    if ([...callsOf(parsed)].some((f) => !KNOWN_FUNCTIONS.has(f) && !fnNames.has(f))) continue;
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
  const defByVar = new Map<string, number>();
  odes.forEach((o, i) => {
    if (!defByVar.has(o.parsed.depVar)) defByVar.set(o.parsed.depVar, i);
  });
  const parent = odes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  odes.forEach((o, i) => {
    for (const dep of o.parsed.deps) {
      const j = defByVar.get(baseVar(dep));
      if (j !== undefined && j !== i) union(i, j);
    }
  });
  const groups = new Map<number, number[]>();
  odes.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });

  const odeCurve = new Map<string, SampledCurve>();
  const odeError = new Map<string, string>();
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => odes[i]);
    // Cache the (expensive) RK4 integration: a group re-integrates only when a
    // member's expression / IVP / a referenced variable / the t-range changes.
    const cacheId = members.map((m) => m.entry.id).sort().join('+');
    const groupDeps = new Set<string>();
    for (const m of members) for (const d of m.parsed.deps) groupDeps.add(baseVar(d));
    const depSig = [...groupDeps]
      .map((d) => (d in scope ? scope[d] : 'u'))
      .join(',');
    const memberSig = members
      .map((m) => `${m.entry.id}:${m.entry.raw}:${m.entry.t0 ?? ''}:${m.entry.ic?.join('_') ?? ''}`)
      .join(';');
    const fnSig = members.some((m) => callsUser(m.parsed)) ? ectx.fnKey : '';
    const gkey = `${memberSig}|${depSig}|${tMin}|${tMax}|${samples}|${fnSig}`;
    const cached = ODE_GROUP_CACHE.get(cacheId);
    if (cached && cached.key === gkey) {
      for (const [id, c] of cached.curves) odeCurve.set(id, c);
      for (const [id, e] of cached.errors) odeError.set(id, e);
      continue;
    }
    const curves = new Map<string, SampledCurve>();
    const errors = new Map<string, string>();
    try {
      const system = buildSystem(members.map((m) => m.parsed), scope);
      const y0 = new Array<number>(system.dim).fill(0);
      let t0 = 0;
      let earliest = Infinity;
      members.forEach((m) => {
        const pos = entries.indexOf(m.entry);
        if (pos < earliest) {
          earliest = pos;
          t0 = m.entry.t0 ?? 0;
        }
      });
      system.blocks.forEach((block, b) => {
        const ic = resolveIC(members[b].entry.ic, block.order);
        for (let k = 0; k < block.order; k++) y0[block.offset + k] = ic[k];
      });
      const traj = integrateSystem(system.deriv, { t0, y0, tMin, tMax, samples });
      system.blocks.forEach((block, b) => {
        curves.set(members[b].entry.id, extractComponent(traj, block.offset));
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const i of idxs) errors.set(odes[i].entry.id, msg);
    }
    for (const [id, c] of curves) odeCurve.set(id, c);
    for (const [id, e] of errors) odeError.set(id, e);
    ODE_GROUP_CACHE.set(cacheId, { key: gkey, curves, errors });
  }

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
      const unknownFns = [...callsOf(parsed)].filter((f) => !KNOWN_FUNCTIONS.has(f) && !fnNames.has(f));
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
          samples,
          yMin: viewport.yMin,
          yMax: viewport.yMax,
        });
        return { parsed, curve };
      }

      if (!entry.visible) {
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
          return { parsed, curve: odeCurve.get(entry.id) ?? EMPTY_CURVE };
        }
        const sctx: SampleCtx = { entry, viewport, samples, pointScope };
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
        `${entry.thetaMin ?? ''},${entry.thetaMax ?? ''}|${depKey(parsed.deps)}|${definedKey}|` +
        `${callsUser(parsed) ? ectx.fnKey : ''}|${parsed.kind === 'frames' ? entry.frames ?? '' : ''}`;
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

  // Drop cache slots for entries that no longer exist, keeping the maps bounded.
  const liveIds = new Set(entries.map((e) => e.id));
  for (const id of [...RESULT_CACHE.keys()]) if (!liveIds.has(id)) RESULT_CACHE.delete(id);
  for (const gid of [...ODE_GROUP_CACHE.keys()]) {
    if (gid.split('+').some((id) => !liveIds.has(id))) ODE_GROUP_CACHE.delete(gid);
  }

  return results;
}
