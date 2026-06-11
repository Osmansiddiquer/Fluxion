import { parseEntry, calledFunctions, type Parsed } from './math/parse';
import { buildSystem } from './math/reduce';
import { compileNode } from './math/compileCache';
import { KNOWN_FUNCTIONS } from './math/builtins';
import { integrateSystem, type Trajectory } from './solver/integrate';
import { sampleFunction } from './solver/sample';
import { sampleImplicit } from './solver/implicit';
import { EMPTY_CURVE, type Point, type SampledCurve } from './solver/curve';
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
}

type OdeParsed = Extract<Parsed, { kind: 'ode' }>;

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

function unknownFunctions(parsed: Parsed): string[] {
  if (parsed.kind === 'function' || parsed.kind === 'ode' || parsed.kind === 'implicit') {
    return [...calledFunctions(parsed.node)].filter((f) => !KNOWN_FUNCTIONS.has(f));
  }
  if (parsed.kind === 'points') {
    const fns = new Set<string>();
    for (const p of parsed.points) {
      if (p.tNode) for (const f of calledFunctions(p.tNode)) fns.add(f);
      if (p.yNode) for (const f of calledFunctions(p.yNode)) fns.add(f);
    }
    return [...fns].filter((f) => !KNOWN_FUNCTIONS.has(f));
  }
  if (parsed.kind === 'pointvar') {
    const fns = new Set<string>();
    for (const f of calledFunctions(parsed.tNode)) fns.add(f);
    for (const f of calledFunctions(parsed.yNode)) fns.add(f);
    return [...fns].filter((f) => !KNOWN_FUNCTIONS.has(f));
  }
  if (parsed.kind === 'polar') {
    return [...calledFunctions(parsed.rNode)].filter((f) => !KNOWN_FUNCTIONS.has(f));
  }
  if (parsed.kind === 'inequality') {
    const fns = new Set<string>();
    for (const p of parsed.parts) for (const f of calledFunctions(p.node)) fns.add(f);
    return [...fns].filter((f) => !KNOWN_FUNCTIONS.has(f));
  }
  return [];
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

export function computeAll(
  entries: Entry[],
  viewport: Viewport,
  samples = 1500,
): Map<string, CurveResult> {
  const { tMin, tMax } = viewport;
  const results = new Map<string, CurveResult>();
  const parsedList = entries.map((e) => ({ entry: e, parsed: parseEntry(e.raw) }));

  // Defined names: variables + (for ODEs) dependent variables.
  const scope: Record<string, number> = {};
  const varNames = new Set<string>();
  const depVars = new Set<string>();
  for (const { entry, parsed } of parsedList) {
    if (parsed.kind === 'variable') {
      scope[parsed.name] = entry.varValue ?? parsed.value;
      varNames.add(parsed.name);
    } else if (parsed.kind === 'ode') {
      depVars.add(parsed.depVar);
    }
  }

  // Point-valued variables (A = (x, y)) resolved to coordinates.
  const pointScope = new Map<string, [number, number]>();
  const pointvarNames = new Set<string>();
  for (const { parsed } of parsedList) {
    if (parsed.kind !== 'pointvar') continue;
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
        odeCurve.set(members[b].entry.id, extractComponent(traj, block.offset));
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const i of idxs) odeError.set(odes[i].entry.id, msg);
    }
  }

  for (const { entry, parsed } of parsedList) {
    if (parsed.kind === 'empty' || parsed.kind === 'variable') {
      results.set(entry.id, { parsed, curve: EMPTY_CURVE });
      continue;
    }
    if (parsed.kind === 'error') {
      results.set(entry.id, { parsed, curve: EMPTY_CURVE, error: parsed.message });
      continue;
    }

    // A bare reference to a point-valued variable (parsed as a function `y = A`).
    let barePoint: string | undefined;
    if (parsed.kind === 'function') {
      const nm = loneSymbol(parsed.node as unknown as { type?: string; name?: string });
      if (nm && pointvarNames.has(nm)) barePoint = nm;
    }

    // Validation common to plottable kinds.
    const unknownFns = unknownFunctions(parsed);
    let defined: Set<string>;
    if (parsed.kind === 'ode') defined = new Set([...varNames, ...depVars]);
    else if (parsed.kind === 'points') defined = new Set([...varNames, ...pointvarNames]);
    else defined = varNames;
    const undefinedVars = barePoint ? [] : parsed.deps.filter((d) => !defined.has(d));

    if (unknownFns.length) {
      results.set(entry.id, {
        parsed,
        curve: EMPTY_CURVE,
        unknownFns,
        error: `Unknown function: ${unknownFns.join(', ')}`,
      });
      continue;
    }
    if (undefinedVars.length) {
      results.set(entry.id, { parsed, curve: EMPTY_CURVE, undefinedVars });
      continue;
    }
    if (!entry.visible) {
      results.set(entry.id, { parsed, curve: EMPTY_CURVE });
      continue;
    }

    try {
      if (barePoint) {
        const coord = pointScope.get(barePoint);
        results.set(entry.id, { parsed, curve: EMPTY_CURVE, points: coord ? [coord] : [] });
      } else if (parsed.kind === 'pointvar') {
        const coord = pointScope.get(parsed.name);
        results.set(entry.id, { parsed, curve: EMPTY_CURVE, points: coord ? [coord] : [] });
      } else if (parsed.kind === 'function') {
        const curve = sampleFunction(compileNode(parsed.node), scope, {
          tMin,
          tMax,
          samples,
          yMin: viewport.yMin,
          yMax: viewport.yMax,
        });
        results.set(entry.id, { parsed, curve });
      } else if (parsed.kind === 'implicit') {
        const curve = sampleImplicit(compileNode(parsed.node), scope, viewport);
        results.set(entry.id, { parsed, curve });
      } else if (parsed.kind === 'polar') {
        const tMinP = entry.thetaMin ?? 0;
        const tMaxP = entry.thetaMax ?? Math.PI * 2;
        const curve = samplePolar(compileNode(parsed.rNode), scope, tMinP, tMaxP);
        results.set(entry.id, { parsed, curve });
      } else if (parsed.kind === 'inequality') {
        // Each constraint contributes a boundary curve; the region is their AND.
        // Wrap so r and θ are always derived from (t, y) — this makes polar
        // constraints (r < f(θ)) work for both the test and the boundary contour.
        const polarWrap = (c: ReturnType<typeof compileNode>) => ({
          evaluate: (s: Record<string, number>): unknown => {
            s.r = Math.hypot(s.t, s.y);
            s['θ'] = Math.atan2(s.y, s.t);
            s.theta = s['θ'];
            return c.evaluate(s);
          },
        });
        const sc: Record<string, number> = { ...scope };
        const compiled = parsed.parts.map((p) => ({ ev: polarWrap(compileNode(p.node)), op: p.op }));
        const test = (t: number, y: number): boolean => {
          sc.t = t;
          sc.y = y;
          for (const c of compiled) {
            let v: unknown;
            try {
              v = c.ev.evaluate(sc);
            } catch {
              return false;
            }
            if (typeof v !== 'number' || Number.isNaN(v)) return false;
            const ok = c.op === '<' ? v < 0 : c.op === '<=' ? v <= 0 : c.op === '>' ? v > 0 : v >= 0;
            if (!ok) return false;
          }
          return true;
        };
        const boundaries = parsed.parts.map((p) => ({
          segments: sampleImplicit(
            polarWrap(compileNode(p.node)) as unknown as Parameters<typeof sampleImplicit>[0],
            scope,
            viewport,
          ).segments,
          strict: p.op === '<' || p.op === '>',
        }));
        results.set(entry.id, {
          parsed,
          curve: { segments: boundaries.flatMap((b) => b.segments) },
          inequality: { test, boundaries },
        });
      } else if (parsed.kind === 'points') {
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
        results.set(entry.id, { parsed, curve, points: coords });
      } else {
        const err = odeError.get(entry.id);
        if (err) results.set(entry.id, { parsed, curve: EMPTY_CURVE, error: err });
        else results.set(entry.id, { parsed, curve: odeCurve.get(entry.id) ?? EMPTY_CURVE });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.set(entry.id, { parsed, curve: EMPTY_CURVE, error: msg });
    }
  }

  return results;
}
