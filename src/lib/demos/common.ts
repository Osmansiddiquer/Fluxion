import type { Entry, FeatureToggles, Projections, Viewport } from '../../store/types';
import type { GraphData } from '../graphFile';

let seq = 0;

/** Build demo entries with fresh ids (so autoplay re-triggers on each load). */
export function entryMaker(prefix: string) {
  const stamp = `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
  let i = 0;
  return (raw: string, color: string, extra: Partial<Entry> = {}): Entry => ({
    id: `${stamp}-${i++}`,
    raw,
    color,
    visible: true,
    expanded: false,
    ...extra,
  });
}

/** Art looks best without inspection markers or grid (both re-enable from the
 * Points menu on the plot). */
export const NO_FEATURES: FeatureToggles = {
  extrema: false,
  xIntercepts: false,
  yIntercept: false,
  endpoints: false,
  discontinuities: false,
  intersections: false,
  grid: false,
};

export const PANELS_OFF: Projections = { rightOpen: false, bottomOpen: false, sliceT: 0, sliceY: 1 };

export function graph(entries: Entry[], viewport: Viewport, assets?: Record<string, string>): GraphData {
  return {
    v: 1,
    entries,
    viewport,
    features: NO_FEATURES,
    projections: PANELS_OFF,
    sigFigs: 3,
    ...(assets ? { assets } : {}),
  };
}

/** A circle as a parametric entry string. A compound radius is parenthesised
 * (with an explicit `*`, since a leading `((` would read as nested points), so
 * `circle('0.5 + k')` scales cos/sin instead of offsetting them. */
export const circle = (r: number | string, cx: number | string = 0, cy: number | string = 0) => {
  const off = (c: number | string) => (c === 0 ? '' : ` + ${c}`);
  const rr = typeof r === 'string' && /[+\-]/.test(r.trim().replace(/^-/, '')) ? `(${r})*` : `${r} `;
  return `(${rr}cos(t)${off(cx)}, ${rr}sin(t)${off(cy)})`;
};
