import type { Viewport } from '../../store/types';

/** Maps between data space (t, y) and screen pixels for a given viewport + size. */
export interface Transform {
  width: number;
  height: number;
  vp: Viewport;
  tx: (t: number) => number;
  ty: (y: number) => number;
  ix: (px: number) => number; // inverse: pixel x -> t
  iy: (py: number) => number; // inverse: pixel y -> y
}

export function makeTransform(vp: Viewport, width: number, height: number): Transform {
  const tSpan = vp.tMax - vp.tMin || 1;
  const ySpan = vp.yMax - vp.yMin || 1;
  return {
    width,
    height,
    vp,
    tx: (t) => ((t - vp.tMin) / tSpan) * width,
    ty: (y) => height - ((y - vp.yMin) / ySpan) * height,
    ix: (px) => vp.tMin + (px / width) * tSpan,
    iy: (py) => vp.yMin + ((height - py) / height) * ySpan,
  };
}

/**
 * Adjust the y-range so one unit is the same number of pixels on both axes
 * (square grid / equal aspect), keeping the t-range and the y-center fixed.
 */
export function correctAspect(vp: Viewport, width: number, height: number): Viewport {
  if (width <= 0 || height <= 0) return vp;
  const desiredYSpan = (vp.tMax - vp.tMin) * (height / width);
  const yc = (vp.yMin + vp.yMax) / 2;
  return {
    tMin: vp.tMin,
    tMax: vp.tMax,
    yMin: yc - desiredYSpan / 2,
    yMax: yc + desiredYSpan / 2,
  };
}

export interface Ticks {
  step: number;
  values: number[];
}

/**
 * Generate "nice" tick values (multiples of 1, 2, or 5 × 10^k) covering
 * [min, max], aiming for roughly `target` ticks.
 */
export function niceTicks(min: number, max: number, target: number): Ticks {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, values: [] };
  const rawStep = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let niceNorm: number;
  if (norm < 1.5) niceNorm = 1;
  else if (norm < 3) niceNorm = 2;
  else if (norm < 7) niceNorm = 5;
  else niceNorm = 10;
  const step = niceNorm * mag;

  const start = Math.ceil(min / step) * step;
  const values: number[] = [];
  // Guard against pathological loops.
  for (let v = start, i = 0; v <= max + step * 1e-9 && i < 1000; v += step, i++) {
    // Snap tiny floating error to a clean value.
    values.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { step, values };
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
}

/** Format a tick label compactly given the tick step (controls precision). */
export function formatTick(value: number, step: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  // Power-of-ten notation for very large/small values: m×10ⁿ (or just 10ⁿ).
  if (abs >= 1e5 || abs < 1e-3) {
    const exp = Math.floor(Math.log10(abs));
    const mant = Number((value / Math.pow(10, exp)).toPrecision(2));
    const am = Math.abs(mant);
    const sign = value < 0 ? '-' : '';
    const prefix = am === 1 ? '' : `${am}×`;
    return `${sign}${prefix}10${toSuperscript(exp)}`;
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const s = value.toFixed(Math.min(decimals, 6));
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
