import type { CurveResult } from './compute';
import type { BlendMode, Entry, LineStyle } from '../store/types';
import { colorExprSymbols, evalColor, evalPaint, paintSolid, parseColorLiteral, toCss, type RGBA } from './color';
import type { Paint } from './script/protocol';

/** Canvas composite operation for each blend mode ('normal' = default). */
export const BLEND_OPS: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  lighten: 'lighten',
  darken: 'darken',
};
export const BLEND_MODES = Object.keys(BLEND_OPS) as BlendMode[];
/** Max glow / blur radius in px (canvas shadows and filters are costly). */
export const MAX_EFFECT_PX = 50;

/** Rendering effects for one entry (data only; applied by lib/render/canvas). */
export interface Effects {
  blend: GlobalCompositeOperation | null;
  /** Glow radius px (a canvas shadow in `glowColor`), 0 = none. */
  glow: number;
  glowColor: string | null;
  /** Gaussian blur radius px, 0 = none. */
  blur: number;
}

/** How an entry is drawn this frame, after defaults and colour expressions. */
export interface ResolvedStyle extends Effects {
  /** Stroke paint (CSS colour or gradient), or null when the stroke is hidden. */
  stroke: Paint | null;
  lineWidth: number;
  dash: number[];
  /** Fill paint (CSS colour or gradient, opacity applied), or null for no fill. */
  fill: Paint | null;
  /** 'region': rasterised inequality; 'shape': filled closed curves. */
  fillMode: 'region' | 'shape' | null;
  fillRule: 'nonzero' | 'evenodd';
  /** Solid version of the stroke colour (for point markers / UI swatches). */
  solid: string;
}

export const DEFAULT_LINE_WIDTH = 2.25;
export const DEFAULT_REGION_OPACITY = 0.16;
export const DEFAULT_SHAPE_OPACITY = 0.4;

/** Kinds whose curve segments are closed outlines that can be filled. */
export function canFillShape(res: CurveResult | undefined): boolean {
  if (!res) return false;
  const p = res.parsed.kind === 'repeat' ? res.parsed.body : res.parsed;
  if (p.kind === 'parametric' || p.kind === 'polar' || p.kind === 'frames') return true;
  return p.kind === 'points' && (res.curve.segments.length > 0 || p.polyline);
}

/**
 * Does an entry draw point markers? Points, named points and repeated points
 * always do. Polylines show vertex dots by default only when plain (a single,
 * unfilled, straight polyline — the segment `((0,0),(1,1))` keeps its ends); a
 * repeated, filled or smooth (spline / bezier / arc) path reads as a shape. The
 * entry's `dots` option overrides the default either way.
 */
export function showsVertexDots(entry: Entry, res: CurveResult | undefined, fillMode: ResolvedStyle['fillMode']): boolean {
  if (!res?.points) return false;
  const p = res.parsed.kind === 'repeat' ? res.parsed.body : res.parsed;
  if (p.kind === 'pointvar') return true;
  if (p.kind !== 'points') return false;
  if (!p.polyline) return true;
  if (entry.dots !== undefined) return entry.dots;
  return res.parsed.kind === 'points' && !p.smooth && fillMode !== 'shape';
}

export function isRegion(res: CurveResult | undefined): boolean {
  return !!res?.inequality;
}

export function dashFor(style: LineStyle | undefined, width: number): number[] {
  const w = Math.max(1, width);
  if (style === 'dashed') return [w * 3.5, w * 2.5];
  // Round caps turn near-zero dashes into dots.
  if (style === 'dotted') return [0.01, w * 2.2];
  return [];
}

const FALLBACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };

/**
 * Resolve an entry's drawing style. `scope` (variables, derived values,
 * helpers) feeds colour expressions so colours / opacity can animate.
 */
export function resolveStyle(
  entry: Entry,
  res: CurveResult | undefined,
  scope: Record<string, unknown>,
): ResolvedStyle {
  const base = parseColorLiteral(entry.color) ?? FALLBACK;
  const strokeC = evalColor(entry.colorExpr, scope) ?? base;
  // A gradient stroke (colorExpr = linear(…) / radial(…)).
  const strokeG = entry.colorExpr && !evalColor(entry.colorExpr, scope) ? evalPaint(entry.colorExpr, scope) : null;
  const isFrames =
    res?.parsed.kind === 'frames' || (res?.parsed.kind === 'repeat' && res.parsed.body.kind === 'frames');

  const lineWidth = Math.max(0, entry.lineWidth ?? (isFrames ? 0 : DEFAULT_LINE_WIDTH));
  const stroke = lineWidth > 0 ? (strokeG ?? (strokeC.a > 0 ? toCss(strokeC) : null)) : null;

  let fillMode: ResolvedStyle['fillMode'] = null;
  let opacity = 0;
  if (isRegion(res)) {
    if (entry.fill ?? true) {
      fillMode = 'region';
      opacity = entry.fillOpacity ?? DEFAULT_REGION_OPACITY;
    }
  } else if (canFillShape(res) && (entry.fill ?? isFrames)) {
    fillMode = 'shape';
    opacity = entry.fillOpacity ?? (isFrames ? 1 : DEFAULT_SHAPE_OPACITY);
  }
  let fill: Paint | null = null;
  if (fillMode && opacity > 0) {
    const fillC = evalColor(entry.fillColor, scope);
    const fillG = fillC ? null : evalPaint(entry.fillColor, scope, opacity);
    if (fillC) fill = fillC.a > 0 ? toCss(fillC, opacity) : null;
    else if (fillG) fill = fillG;
    else if (strokeG) fill = evalPaint(entry.colorExpr, scope, opacity);
    else if (strokeC.a > 0) fill = toCss(strokeC, opacity);
  }

  const fx = (v: number | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_EFFECT_PX, Math.max(0, v)) : 0;
  const glow = fx(entry.glow);
  return {
    stroke,
    lineWidth,
    dash: dashFor(entry.lineStyle, lineWidth),
    fill,
    fillMode: fill ? fillMode : null,
    fillRule: res?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    solid: strokeG ? (paintSolid(strokeG) ?? toCss({ ...strokeC, a: 1 })) : toCss({ ...strokeC, a: 1 }),
    blend: entry.blend && entry.blend !== 'normal' ? (BLEND_OPS[entry.blend] ?? null) : null,
    glow,
    glowColor: glow > 0 ? (paintSolid(stroke) ?? paintSolid(fill) ?? toCss(strokeC)) : null,
    blur: fx(entry.blur),
  };
}

/**
 * Per-copy styles for a `for` repeat whose colour expressions use a loop
 * variable (`hsv(30k, 0.7, 1)`, `linear(…, k/21, …)`): one style per copy,
 * resolved with that copy's loop values over the global scope. Null when the
 * colours don't depend on the loop (the common case: one style for all).
 */
export function resolveCopyStyles(
  entry: Entry,
  res: CurveResult | undefined,
  scope: Record<string, unknown>,
): ResolvedStyle[] | null {
  if (!res?.copyRanges || res.parsed.kind !== 'repeat') return null;
  const loopNames = new Set(res.parsed.loops.map((l) => l.name));
  const uses = [...colorExprSymbols(entry.colorExpr), ...colorExprSymbols(entry.fillColor)].some((n) => loopNames.has(n));
  if (!uses) return null;
  return res.copyRanges.map((c) => {
    const local = Object.create(scope) as Record<string, unknown>;
    Object.assign(local, c.vars);
    return resolveStyle(entry, res, local);
  });
}
