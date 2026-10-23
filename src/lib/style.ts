import type { CurveResult } from './compute';
import type { Entry, LineStyle } from '../store/types';
import { evalColor, parseColorLiteral, toCss, type RGBA } from './color';

/** How an entry is drawn this frame, after defaults and colour expressions. */
export interface ResolvedStyle {
  /** CSS stroke colour, or null when the stroke is hidden. */
  stroke: string | null;
  lineWidth: number;
  dash: number[];
  /** CSS fill colour (opacity applied), or null for no fill. */
  fill: string | null;
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
  const isFrames =
    res?.parsed.kind === 'frames' || (res?.parsed.kind === 'repeat' && res.parsed.body.kind === 'frames');

  const lineWidth = Math.max(0, entry.lineWidth ?? (isFrames ? 0 : DEFAULT_LINE_WIDTH));
  const stroke = lineWidth > 0 && strokeC.a > 0 ? toCss(strokeC) : null;

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
  const fillC = evalColor(entry.fillColor, scope) ?? strokeC;
  const fill = fillMode && opacity > 0 && fillC.a > 0 ? toCss(fillC, opacity) : null;

  return {
    stroke,
    lineWidth,
    dash: dashFor(entry.lineStyle, lineWidth),
    fill,
    fillMode: fill ? fillMode : null,
    fillRule: res?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    solid: toCss({ ...strokeC, a: 1 }),
  };
}
