import { parseEntry } from '../math/parse';
import type { GraphData } from '../graphFile';
import type { Entry, FeatureToggles, Projections, ScriptDoc, Viewport } from '../../store/types';
import { nextColor } from '../../utils/colors';
import {
  ANIM_MODES,
  DEFAULT_FEATURES,
  DEFAULT_PROJECTIONS,
  DEFAULT_SIG_FIGS,
  DEFAULT_VIEWPORT,
  DRAG_MODES,
  FEATURE_KEYS,
  LAYER_NAME,
  LIMITS,
  LINE_STYLES,
  POINT_DIRS,
  STATE_NAME,
  isSafeExpression,
  resolveColor,
  specToGraph,
  validateSpec,
} from './spec';
import { readUrlPayload } from './url';
import { isColorExpr } from '../color';
import { BLEND_MODES } from '../style';
import { assetId } from '../frames/assets';
import { parseHeader } from '../frames/codec';
import { SCRIPT_LIMITS } from '../script/protocol';

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
      if (finite(e.animSpeed)) {
        out.animSpeed = Math.min(LIMITS.maxSpeed, Math.max(LIMITS.minSpeed, e.animSpeed));
      }
      if (e.autoplay === true) out.autoplay = true;
      // Drawing style (cosmetic; colour expressions only reach the mathjs pipeline,
      // and evalColor refuses calls to anything but built-ins / user functions).
      if (finite(e.lineWidth)) out.lineWidth = Math.min(LIMITS.maxLineWidth, Math.max(0, e.lineWidth));
      const ls = oneOf(e.lineStyle, LINE_STYLES);
      if (ls) out.lineStyle = ls;
      if (typeof e.fill === 'boolean') out.fill = e.fill;
      if (finite(e.fillOpacity)) out.fillOpacity = Math.min(1, Math.max(0, e.fillOpacity));
      for (const k of ['colorExpr', 'fillColor'] as const) {
        const c = e[k];
        if (typeof c === 'string' && c.trim() && c.length <= LIMITS.maxColorExprLength && isColorExpr(c)) {
          out[k] = c;
        }
      }
      if (typeof e.frames === 'string' && ASSET_ID.test(e.frames)) out.frames = e.frames;
      // Animation & rendering options (bounded; all optional).
      if (finite(e.samples)) out.samples = Math.round(Math.min(LIMITS.maxSamples, Math.max(LIMITS.minSamples, e.samples)));
      if (typeof e.dots === 'boolean') out.dots = e.dots;
      const blend = oneOf(e.blend, BLEND_MODES);
      if (blend) out.blend = blend;
      for (const k of ['glow', 'blur'] as const) {
        if (finite(e[k])) out[k] = Math.min(LIMITS.maxEffectPx, Math.max(0, e[k]!));
      }
      if (typeof e.layer === 'string' && e.layer.length <= LIMITS.maxLayerName && LAYER_NAME.test(e.layer)) out.layer = e.layer;
      if (typeof e.pointLabel === 'string') out.pointLabel = e.pointLabel.slice(0, LIMITS.maxLabelLength);
      const dir = oneOf(e.pointLabelDir, POINT_DIRS);
      if (dir) out.pointLabelDir = dir;
      if (finite(e.pointSize)) out.pointSize = Math.min(14, Math.max(2, e.pointSize));
      const drag = oneOf(e.pointDrag, DRAG_MODES);
      if (drag) out.pointDrag = drag;
      // ODE view (lib/ode): booleans, state names, bounded extra-solution states.
      if (typeof e.field === 'boolean') out.field = e.field;
      if (e.phase === true) out.phase = true;
      if (
        Array.isArray(e.phaseAxes) &&
        e.phaseAxes.length === 2 &&
        e.phaseAxes.every((n) => typeof n === 'string' && n.length <= LIMITS.maxStateName && STATE_NAME.test(n))
      ) {
        out.phaseAxes = [e.phaseAxes[0], e.phaseAxes[1]];
      }
      if (Array.isArray(e.extraICs)) {
        const ok = e.extraICs
          .filter(
            (v) => Array.isArray(v) && v.length >= 2 && v.length <= LIMITS.maxIcLength + 1 && v.every((x) => inAbs(x)),
          )
          .slice(0, LIMITS.maxExtraICs)
          .map((v) => v.slice());
        if (ok.length) out.extraICs = ok;
      }
      if (e.family === true) out.family = true;
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
  if (finite(f.aspect) && f.aspect >= LIMITS.minAspect && f.aspect <= LIMITS.maxAspect) features.aspect = f.aspect;
  if (finite(f.fps) && f.fps >= 1 && f.fps <= LIMITS.maxFps) features.fps = f.fps;

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
  const out: GraphData = { v: 1, entries, viewport, features, projections, sigFigs };
  const script = sanitizeScript(g.script);
  if (script) out.script = script;
  const assets = sanitizeAssets(g.assets, entries, Object.values(script?.clips ?? {}));
  if (assets) out.assets = assets;
  return out;
}

const ASSET_ID = /^fx[0-9a-f]{8}[0-9a-z]{1,10}$/;
/** Script slider names (as slider() accepts) and clip names. */
const SLIDER_NAME = /^[A-Za-z_$][\w$ ]*$/;
export const CLIP_NAME = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * A graph's Script-mode program. The code itself is only ever run inside the
 * sandbox (lib/script/sandbox), so here it is just a size-capped string; the
 * slider values and clip table are type-checked and bounded.
 */
export function sanitizeScript(raw: unknown): ScriptDoc | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'string' || !r.code.trim() || r.code.length > SCRIPT_LIMITS.maxCodeChars) return undefined;
  const out: ScriptDoc = { code: r.code };
  if (r.sliders && typeof r.sliders === 'object' && !Array.isArray(r.sliders)) {
    const sl: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.sliders as Record<string, unknown>).slice(0, SCRIPT_LIMITS.maxSliders)) {
      if (SLIDER_NAME.test(k) && k.length <= SCRIPT_LIMITS.maxName && inAbs(v)) sl[k] = v;
    }
    if (Object.keys(sl).length) out.sliders = sl;
  }
  if (r.clips && typeof r.clips === 'object' && !Array.isArray(r.clips)) {
    const cl: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.clips as Record<string, unknown>).slice(0, SCRIPT_LIMITS.maxClips)) {
      if (CLIP_NAME.test(k) && typeof v === 'string' && ASSET_ID.test(v)) cl[k] = v;
    }
    if (Object.keys(cl).length) out.clips = cl;
  }
  if (r.visible === false) out.visible = false;
  return out;
}

/**
 * Frame-sequence payloads carried by a graph file / link. Keep only assets an
 * entry references, whose id is the content hash of the data (so a link can't
 * smuggle a different payload under a known id), which parse as a clip, and
 * that fit the size caps. Entries pointing at a dropped asset just show
 * "Frame data not found".
 */
export function sanitizeAssets(
  raw: unknown,
  entries: Entry[],
  extraIds: string[] = [],
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const wanted = new Set([...entries.map((e) => e.frames), ...extraIds].filter((f): f is string => !!f));
  const out: Record<string, string> = {};
  let total = 0;
  let n = 0;
  for (const [id, data] of Object.entries(raw as Record<string, unknown>)) {
    if (!wanted.has(id) || typeof data !== 'string') continue;
    if (n >= LIMITS.maxAssets || data.length > LIMITS.maxAssetChars) continue;
    if (total + data.length > LIMITS.maxAssetsTotalChars) continue;
    if (assetId(data) !== id) continue;
    try {
      parseHeader(data);
    } catch {
      continue;
    }
    out[id] = data;
    total += data.length;
    n++;
  }
  return n ? out : undefined;
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
