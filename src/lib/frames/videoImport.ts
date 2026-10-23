/**
 * In-app clip import (Script mode "Clips"): the pure part. The component
 * decodes a video / GIF / image sequence in the browser into RGBA frames; this
 * turns each into traced contours (trace.ts) and the whole set into an FXF1
 * clip (codec.ts), exactly like scripts/frames-import.ts does from the CLI.
 */
import { encodeClip, type IPoly } from './codec';
import { threshold, vectorize } from './trace';
import { LIMITS } from '../api/spec';

export const IMPORT_LIMITS = {
  /** Longest stretch of video imported in the browser (s). Longer → CLI. */
  maxSeconds: 60,
  maxFrames: 1800,
  minWidth: 48,
  maxWidth: 320,
  minFps: 1,
  maxFps: 30,
  /** Largest encoded clip accepted (characters; same cap as graph files). */
  maxChars: LIMITS.maxAssetChars,
} as const;

export interface TraceOptions {
  /** Gray level 0–255 splitting ink from paper. */
  threshold: number;
  /** Treat light pixels as ink. */
  invert: boolean;
  /** Simplification tolerance (half-pixels); bigger = smaller, blockier. */
  tolerance: number;
  /** Drop specks smaller than this (half-pixels²). */
  minArea: number;
}

export const DEFAULT_TRACE: TraceOptions = { threshold: 128, invert: false, tolerance: 1.1, minArea: 4 };

/** Luma (Rec. 601) of RGBA pixels; transparent pixels count as white paper. */
export function grayFromRGBA(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    const y = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    out[i] = Math.round(y * a + 255 * (1 - a));
  }
  return out;
}

/** Binary ink mask (1 = ink) of a gray frame, for the live preview. */
export function inkMask(gray: Uint8Array, width: number, height: number, o: Pick<TraceOptions, 'threshold' | 'invert'>): Uint8Array {
  return threshold(gray, width, height, o.threshold, !o.invert).data;
}

export function traceGray(gray: Uint8Array, width: number, height: number, o: TraceOptions): IPoly[] {
  return vectorize(threshold(gray, width, height, o.threshold, !o.invert), o.tolerance, o.minArea);
}

/** Output size for a source of srcW × srcH scaled to `width` px wide (even numbers). */
export function scaledSize(srcW: number, srcH: number, width: number): { w: number; h: number } {
  const w = Math.max(IMPORT_LIMITS.minWidth, Math.min(IMPORT_LIMITS.maxWidth, Math.round(width / 2) * 2));
  const h = Math.max(2, Math.round((w * srcH) / Math.max(1, srcW) / 2) * 2);
  return { w, h: Math.min(h, IMPORT_LIMITS.maxWidth * 2) };
}

/** Times (s) to sample a video at, capped by duration / frame limits. */
export function frameTimes(duration: number, fps: number, start = 0, end = duration): number[] {
  const f = Math.max(IMPORT_LIMITS.minFps, Math.min(IMPORT_LIMITS.maxFps, fps));
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration, s + IMPORT_LIMITS.maxSeconds));
  const n = Math.min(IMPORT_LIMITS.maxFrames, Math.max(1, Math.floor((e - s) * f + 1e-9)));
  return Array.from({ length: n }, (_, i) => s + (i + 0.5) / f);
}

/** Encode traced frames (width × height px) as a clip `dataWidth` units wide, centred. */
export function buildClip(frames: IPoly[][], width: number, height: number, fps: number, dataWidth = 8): string {
  const halfW = dataWidth / 2;
  const halfH = (dataWidth * height) / width / 2;
  return encodeClip({ w: 2 * width, h: 2 * height, fps, box: [-halfW, -halfH, halfW, halfH], frames });
}

/** A clip name the script can use: letters, digits, - and _. */
export function cleanClipName(raw: string, taken: string[] = []): string {
  let base = raw
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .toLowerCase();
  if (!base) base = 'clip';
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}-${i}`;
  return name;
}
