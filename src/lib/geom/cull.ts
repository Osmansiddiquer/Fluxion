import type { Point } from '../solver/curve';

/**
 * Draw-time culling: the data-space bounding box of each segment, computed once
 * per segment array (results are cached, so this is once per recompute), lets
 * the renderer skip strokes and fills that are entirely off-screen.
 */
const boxes = new WeakMap<Point[], [number, number, number, number]>();

export function segmentBox(seg: Point[]): [number, number, number, number] {
  let b = boxes.get(seg);
  if (!b) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of seg) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    b = [x0, y0, x1, y1];
    boxes.set(seg, b);
  }
  return b;
}

/** Is the segment entirely outside the rectangle (data units, margin included)? */
export function segmentOutside(
  seg: Point[],
  view: { tMin: number; tMax: number; yMin: number; yMax: number },
  margin: number,
): boolean {
  const [x0, y0, x1, y1] = segmentBox(seg);
  return x1 < view.tMin - margin || x0 > view.tMax + margin || y1 < view.yMin - margin || y0 > view.yMax + margin;
}
