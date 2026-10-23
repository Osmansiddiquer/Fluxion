import type { AnimMode, Entry } from '../store/types';
import { parseEntry } from './math/parse';

/** One animation step of a slider value across [min, max]. */
export function advance(
  value: number,
  dir: 1 | -1,
  min: number,
  max: number,
  mode: AnimMode,
  speed: number,
  dt: number,
): { value: number; dir: 1 | -1; finished: boolean } {
  const span = Math.max(1e-9, max - min);
  const rate = (span * Math.max(1e-4, speed)) / 4; // full sweep in ~4s at 1× (tiny speeds allowed: real-time clips)
  let v = value + dir * rate * dt;
  let d = dir;
  let finished = false;
  if (v >= max) {
    if (mode === 'loop') v = min + ((v - max) % span);
    else if (mode === 'bounce') {
      v = max;
      d = -1;
    } else {
      v = max;
      finished = true;
    }
  } else if (v <= min) {
    if (mode === 'loop') v = max - ((min - v) % span);
    else if (mode === 'bounce') {
      v = min;
      d = 1;
    } else {
      v = min;
      finished = true;
    }
  }
  return { value: v, dir: d, finished };
}

/**
 * A fine slider step: a power of ten about 1/1000 of the range, so a default
 * −10…10 slider steps by 0.1 and a tighter −1…1 slider by 0.01.
 */
export function fineStep(span: number): number {
  if (!(span > 0)) return 0.01;
  return Math.pow(10, Math.floor(Math.log10(span / 100)));
}

/** Effective slider bounds / step / value for a variable entry. */
export function sliderBounds(entry: Entry, definedValue: number) {
  const value = entry.varValue ?? definedValue;
  const min = entry.varMin ?? Math.min(-10, value);
  const max = entry.varMax ?? Math.max(10, value);
  const step = entry.varStep ?? fineStep(max - min);
  return { value, min, max, step };
}

/** One frame-step (‹ / ›) of a slider: by its step, clamped to the range. */
export function stepValue(value: number, min: number, max: number, step: number, dir: 1 | -1): number {
  const s = step > 0 ? step : fineStep(max - min);
  // Snap onto the step grid so repeated steps land on exact frames.
  const k = Math.round((value - min) / s) + dir;
  return Math.min(max, Math.max(min, min + k * s));
}

/**
 * Deterministic clock: a slider's value `seconds` after it started at `start`,
 * as a pure function (no accumulated floating-point drift, and a bounce reflects
 * any overshoot). `advance` integrated over the same time gives the same value
 * up to rounding. Also returns the direction and whether a "once" run ended.
 */
export function valueAt(
  start: number,
  min: number,
  max: number,
  mode: AnimMode,
  speed: number,
  seconds: number,
): { value: number; dir: 1 | -1; finished: boolean } {
  const span = Math.max(1e-9, max - min);
  const rate = (span * Math.max(1e-4, speed)) / 4;
  const s = Math.max(0, seconds);
  const off = Math.min(max, Math.max(min, start)) - min + rate * s;
  if (mode === 'loop') {
    const m = off % span;
    return { value: min + (m < 0 ? m + span : m), dir: 1, finished: false };
  }
  if (mode === 'bounce') {
    const p = off % (2 * span);
    return p <= span ? { value: min + p, dir: 1, finished: false } : { value: max - (p - span), dir: -1, finished: false };
  }
  return off >= span ? { value: max, dir: 1, finished: true } : { value: min + off, dir: 1, finished: false };
}

/** The frame number shown at `seconds` for a fixed `fps` (frame N spans [N/fps, (N+1)/fps)). */
export function frameAt(seconds: number, fps: number): number {
  return Math.floor(seconds * fps + 1e-9);
}

/**
 * A graph at a given time: every `autoplay` slider set to its value `seconds`
 * after the graph opened (from its stored value), and paused. Used by the
 * `time=` / `frame=` link options to render one frame without any animation
 * loop — so headless capture works even in throttled background tabs.
 */
export function entriesAtTime(entries: Entry[], seconds: number): Entry[] {
  return entries.map((e) => {
    if (!e.autoplay) return e;
    const p = parseEntry(e.raw);
    if (p.kind !== 'variable') return e;
    const { value, min, max } = sliderBounds(e, p.value);
    const r = valueAt(value, min, max, e.animMode ?? 'loop', e.animSpeed ?? 1, seconds);
    const out: Entry = { ...e, varValue: r.value };
    delete out.autoplay;
    return out;
  });
}
