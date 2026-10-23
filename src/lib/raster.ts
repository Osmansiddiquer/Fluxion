/**
 * Adaptive rasterisation of a region test (inequality shading). The canvas is
 * scanned on a coarse grid; a cell whose corners and centre all agree is filled
 * (or skipped) whole, and only mixed cells — the region's edge — are refined at
 * the fine step. Edges come out ~4× sharper than a uniform coarse grid for about
 * the same number of evaluations. Rects are merged into horizontal runs.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rasterizeRegion(
  test: (t: number, y: number) => boolean,
  width: number,
  height: number,
  ix: (px: number) => number,
  iy: (py: number) => number,
  coarse = 8,
  fine = 2,
): Rect[] {
  const cols = Math.ceil(width / coarse);
  const rows = Math.ceil(height / coarse);
  const safe = (px: number, py: number) => {
    try {
      return test(ix(px), iy(py));
    } catch {
      return false;
    }
  };
  // Corner samples, (cols+1) × (rows+1).
  const corner = new Uint8Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    const py = Math.min(height, j * coarse);
    for (let i = 0; i <= cols; i++) corner[j * (cols + 1) + i] = safe(Math.min(width, i * coarse), py) ? 1 : 0;
  }

  const rects: Rect[] = [];
  // Per output row band, collect runs at fine resolution so adjacent fills merge.
  const sub = Math.max(1, Math.round(coarse / fine));
  for (let j = 0; j < rows; j++) {
    const y0 = j * coarse;
    const bandH = Math.min(coarse, height - y0);
    // Fine scanlines within this band: bits[k][x] for x at fine resolution.
    const lineW = cols * sub;
    const lines: Uint8Array[] = Array.from({ length: sub }, () => new Uint8Array(lineW));
    for (let i = 0; i < cols; i++) {
      const x0 = i * coarse;
      const c00 = corner[j * (cols + 1) + i];
      const c10 = corner[j * (cols + 1) + i + 1];
      const c01 = corner[(j + 1) * (cols + 1) + i];
      const c11 = corner[(j + 1) * (cols + 1) + i + 1];
      const cw = Math.min(coarse, width - x0);
      const centre = safe(x0 + cw / 2, y0 + bandH / 2) ? 1 : 0;
      const sum = c00 + c10 + c01 + c11 + centre;
      if (sum === 0 || sum === 5) {
        if (sum === 5) for (let k = 0; k < sub; k++) lines[k].fill(1, i * sub, i * sub + sub);
        continue;
      }
      for (let k = 0; k < sub; k++) {
        const py = y0 + (k + 0.5) * fine;
        if (py >= height) break;
        for (let m = 0; m < sub; m++) {
          const px = x0 + (m + 0.5) * fine;
          if (px >= width) break;
          if (safe(px, py)) lines[k][i * sub + m] = 1;
        }
      }
    }
    // Merge: if all sub-lines are identical, emit one tall run per span.
    const same = lines.every((l) => l.every((v, x) => v === lines[0][x]));
    const emit = (line: Uint8Array, y: number, h: number) => {
      let x = 0;
      while (x < lineW) {
        if (!line[x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < lineW && line[x]) x++;
        const px0 = start * fine;
        const px1 = Math.min(width, x * fine);
        if (px1 > px0) rects.push({ x: px0, y, w: px1 - px0, h });
      }
    };
    if (same) emit(lines[0], y0, bandH);
    else
      for (let k = 0; k < sub; k++) {
        const y = y0 + k * fine;
        if (y >= height) break;
        emit(lines[k], y, Math.min(fine, height - y));
      }
  }
  return rects;
}
