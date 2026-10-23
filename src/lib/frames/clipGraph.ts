import type { GraphData } from '../graphFile';
import type { Entry, FeatureToggles } from '../../store/types';
import { parseHeader } from './codec';
import { assetId } from './assets';

const CLEAN: FeatureToggles = {
  extrema: false,
  xIntercepts: false,
  yIntercept: false,
  endpoints: false,
  discontinuities: false,
  intersections: false,
  grid: false,
};

/**
 * A ready-to-open graph that plays an encoded clip (FXF1): a clock `T` swept in
 * real time over the clip's duration (one slider step = one frame), a light
 * "screen" behind it, and the `frames(fps·T)` entry referencing the clip as an
 * asset. Used by the importer script and the built-in silhouette demo.
 */
export function clipGraph(data: string, opts: { idPrefix?: string; autoplay?: boolean } = {}): GraphData {
  const { fps, box } = parseHeader(data);
  const count = data.split('\n').length - 1;
  const seconds = Math.max(1 / fps, count / fps);
  const id = assetId(data);
  const pre = opts.idPrefix ?? `clip${Date.now().toString(36)}`;
  const [x0, y0, x1, y1] = box;
  const r = (n: number) => +n.toFixed(4);
  const mk = (i: number, raw: string, color: string, extra: Partial<Entry> = {}): Entry => ({
    id: `${pre}-${i}`,
    raw,
    color,
    visible: true,
    expanded: false,
    ...extra,
  });
  const entries: Entry[] = [
    mk(0, 'T = 0', '#2d70b3', {
      varMin: 0,
      varMax: r(seconds),
      varStep: 1 / fps,
      animMode: 'loop',
      animSpeed: 4 / seconds, // a full sweep takes `seconds`: real time
      autoplay: opts.autoplay ?? true,
      expanded: true,
    }),
    mk(1, `((${r(x0)}, ${r(y0)}), (${r(x1)}, ${r(y0)}), (${r(x1)}, ${r(y1)}), (${r(x0)}, ${r(y1)}), (${r(x0)}, ${r(y0)}))`, '#3a3f47', {
      fill: true,
      fillOpacity: 1,
      fillColor: '#f6f4ef',
      lineWidth: 2,
    }),
    mk(2, `frames(${fps} T)`, '#111111', { frames: id }),
  ];
  const w = x1 - x0;
  const h = y1 - y0;
  return {
    v: 1,
    entries,
    viewport: { tMin: x0 - w * 0.19, tMax: x1 + w * 0.19, yMin: y0 - h * 0.1, yMax: y1 + h * 0.1 },
    features: CLEAN,
    projections: { rightOpen: false, bottomOpen: false, sliceT: 0, sliceY: 1 },
    sigFigs: 3,
    assets: { [id]: data },
  };
}
