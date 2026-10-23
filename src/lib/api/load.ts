import { parseEntry } from '../math/parse';
import type { GraphData } from '../graphFile';
import type { Entry, FeatureToggles, Projections, Viewport } from '../../store/types';
import { nextColor } from '../../utils/colors';
import {
  ANIM_MODES,
  DEFAULT_FEATURES,
  DEFAULT_PROJECTIONS,
  DEFAULT_SIG_FIGS,
  DEFAULT_VIEWPORT,
  DRAG_MODES,
  FEATURE_KEYS,
  LIMITS,
  POINT_DIRS,
  isSafeExpression,
  resolveColor,
  specToGraph,
  validateSpec,
} from './spec';
import { readUrlPayload } from './url';

/**
 * Glue between the URL API and the app: turn the current location into a graph
 * to load, plus an optional message for a toast. Pure apart from its inputs, so
 * it's unit-tested in Node.
 */

export interface LoadOutcome {
  graph?: GraphData;
  message?: string;
  tone: 'info' | 'error';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inAbs = (v: unknown, abs: number = LIMITS.maxAbs): v is number => finite(v) && Math.abs(v) <= abs;
const optNum = (v: unknown, abs?: number) => (inAbs(v, abs) ? v : undefined);
const oneOf = <T extends string>(v: unknown, opts: readonly T[]) =>
  typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : undefined;

/**
 * Legacy `#g=` share links and imported files carry raw internal `Entry` objects.
 * Treat them as untrusted: copy only known fields with the right types and sane
 * bounds, so a hand-edited link can't inject odd values or freeze the renderer.
 */
export function sanitizeGraph(g: GraphData): GraphData {
  const src = Array.isArray(g.entries) ? g.entries.slice(0, LIMITS.maxExpressions) : [];
  const colors: string[] = [];
  const entries: Entry[] = src
    .filter((e) => e && typeof e === 'object' && typeof (e as Entry).raw === 'string')
    .map((e, i) => {
      const color =
        (typeof e.color === 'string' && resolveColor(e.color)) || nextColor(colors);
      colors.push(color);
      const out: Entry = {
        id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : `g-${i + 1}`,
        raw: e.raw.slice(0, LIMITS.maxExprLength),
        color,
        visible: e.visible !== false,
        expanded: e.expanded !== false,
      };
      const t0 = optNum(e.t0);
      if (t0 !== undefined) out.t0 = t0;
      if (Array.isArray(e.ic) && e.ic.length <= LIMITS.maxIcLength && e.ic.every((v) => inAbs(v))) {
        out.ic = e.ic.slice();
      }
      for (const k of ['varValue', 'varMin', 'varMax', 'varStep'] as const) {
        const n = optNum(e[k]);
        if (n !== undefined) out[k] = n;
      }
      const thMin = optNum(e.thetaMin, LIMITS.maxThetaAbs);
      const thMax = optNum(e.thetaMax, LIMITS.maxThetaAbs);
      if ((thMax ?? Math.PI * 2) - (thMin ?? 0) <= LIMITS.maxThetaSpan) {
        if (thMin !== undefined) out.thetaMin = thMin;
        if (thMax !== undefined) out.thetaMax = thMax;
      }
      const anim = oneOf(e.animMode, ANIM_MODES);
      if (anim) out.animMode = anim;
      if (finite(e.animSpeed)) out.animSpeed = Math.min(5, Math.max(0.1, e.animSpeed));
      if (typeof e.pointLabel === 'string') out.pointLabel = e.pointLabel.slice(0, LIMITS.maxLabelLength);
      const dir = oneOf(e.pointLabelDir, POINT_DIRS);
      if (dir) out.pointLabelDir = dir;
      if (finite(e.pointSize)) out.pointSize = Math.min(14, Math.max(2, Math.round(e.pointSize)));
      const drag = oneOf(e.pointDrag, DRAG_MODES);
      if (drag) out.pointDrag = drag;
      return out;
    });
  // Ids must be unique (they key caches and React rows).
  const seen = new Set<string>();
  for (const [i, e] of entries.entries()) {
    if (seen.has(e.id)) e.id = `g-${i + 1}-${seen.size}`;
    seen.add(e.id);
  }

  const v = (g.viewport ?? {}) as Partial<Viewport>;
  const viewport: Viewport =
    inAbs(v.tMin) && inAbs(v.tMax) && inAbs(v.yMin) && inAbs(v.yMax) && v.tMax > v.tMin && v.yMax > v.yMin
      ? { tMin: v.tMin, tMax: v.tMax, yMin: v.yMin, yMax: v.yMax }
      : { ...DEFAULT_VIEWPORT };

  const features: FeatureToggles = { ...DEFAULT_FEATURES };
  const f = (g.features ?? {}) as Partial<FeatureToggles>;
  for (const k of FEATURE_KEYS) if (typeof f[k] === 'boolean') features[k] = f[k]!;

  const p = (g.projections ?? {}) as Partial<Projections>;
  const projections: Projections = {
    rightOpen: typeof p.rightOpen === 'boolean' ? p.rightOpen : DEFAULT_PROJECTIONS.rightOpen,
    bottomOpen: typeof p.bottomOpen === 'boolean' ? p.bottomOpen : DEFAULT_PROJECTIONS.bottomOpen,
    sliceT: optNum(p.sliceT) ?? DEFAULT_PROJECTIONS.sliceT,
    sliceY: optNum(p.sliceY) ?? DEFAULT_PROJECTIONS.sliceY,
  };
  const okSlice = (s: unknown): s is string =>
    typeof s === 'string' && s.length <= LIMITS.maxConstLength && isSafeExpression(s);
  if (okSlice(p.sliceTExpr)) projections.sliceTExpr = p.sliceTExpr;
  if (okSlice(p.sliceYExpr)) projections.sliceYExpr = p.sliceYExpr;

  const sigFigs = finite(g.sigFigs) ? Math.min(12, Math.max(1, Math.round(g.sigFigs))) : DEFAULT_SIG_FIGS;
  return { v: 1, entries, viewport, features, projections, sigFigs };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Resolve the graph (if any) carried by a location's hash / query string. */
export async function loadFromUrl(hash: string, search: string): Promise<LoadOutcome | null> {
  const payload = await readUrlPayload(hash, search);
  if (payload.kind === 'none') return null;
  if (payload.kind === 'error') return { tone: 'error', message: payload.message };
  if (payload.kind === 'legacy') return { tone: 'info', graph: sanitizeGraph(payload.graph) };

  const v = validateSpec(payload.spec);
  if (!v.ok) {
    const first = v.errors[0];
    const where = first.path ? `${first.path}: ` : '';
    const more = v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : '';
    // The 'Allowed: …' key list helps agents (CLI / checkSpec) but is noise in a toast.
    const msg = first.message.replace(/\. Allowed: .*$/, '');
    return { tone: 'error', message: `This link's graph is invalid — ${where}${msg}${more}` };
  }
  const graph = specToGraph(v.spec);
  const bad = graph.entries.filter((e) => parseEntry(e.raw).kind === 'error').length;
  if (bad) {
    return { tone: 'error', graph, message: `Graph loaded, but ${plural(bad, 'expression')} could not be parsed` };
  }
  return { tone: 'info', graph };
}
