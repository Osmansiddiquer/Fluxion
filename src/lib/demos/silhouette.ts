import type { GraphData } from '../graphFile';
import { encodeClip, type IPoly } from '../frames/codec';
import { vectorize } from '../frames/trace';
import { putAsset } from '../frames/assets';
import { entryMaker, graph } from './common';

/**
 * A short, procedurally generated black-and-white silhouette clip in the
 * spirit of "Bad Apple!!" (no copyrighted frames): an apple drops in and
 * bounces, spins, then the palette inverts behind a closing iris wipe.
 * Every frame is rasterised, traced into contours and encoded exactly like an
 * imported clip (scripts/frames-import.ts), so this exercises the full path.
 */
export const CLIP_W = 128;
export const CLIP_H = 96;
export const CLIP_FPS = 24;
export const CLIP_FRAMES = 120;

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** Is (x, y) (in units where the frame is [-4, 4] × [-3, 3]) inside the apple? */
function apple(x: number, y: number, cx: number, cy: number, sx: number, sy: number, spin: number): boolean {
  // Undo the squash / spin (spin squeezes horizontally like a 3D turn).
  const u = (x - cx) / (sx * Math.max(0.06, Math.abs(Math.cos(spin))));
  const v = (y - cy) / sy;
  // Body: two overlapping discs with a notch on top.
  const body = Math.hypot(u - 0.42, v + 0.05) < 0.78 || Math.hypot(u + 0.42, v + 0.05) < 0.78;
  const notch = Math.hypot(u, v - 0.95) < 0.28;
  const bottom = Math.hypot(u, v + 1.05) < 0.16;
  // Stem and leaf.
  const stem = Math.abs(u - 0.08 - 0.12 * (v - 0.7)) < 0.07 && v > 0.62 && v < 1.15;
  const leaf = Math.hypot((u - 0.42) / 0.36, (v - 1.02) / 0.15) < 1 && Math.abs(Math.atan2(v - 1.02, u - 0.42)) < 2.6;
  return (body && !notch && !bottom) || stem || leaf;
}

/** Ink mask for frame f. */
export function silhouetteFrame(f: number, W = CLIP_W, H = CLIP_H): Uint8Array {
  const data = new Uint8Array(W * H);
  let cx = 0;
  let cy = 0;
  let sx = 1;
  let sy = 1;
  let spin = 0;
  let invert = false;
  let iris = Infinity;
  if (f < 48) {
    // Drop and bounce (|cos| arcs with decaying height), squash on impact.
    const tt = f / 47;
    const h = Math.abs(Math.cos(tt * Math.PI * 2.5)) * (1 - tt) * 2.6;
    cy = -1.55 + h;
    const impact = Math.max(0, 1 - h / 0.35);
    sx = 1 + 0.22 * impact;
    sy = 1 - 0.2 * impact;
    cy -= 0.2 * impact;
  } else if (f < 84) {
    // Spin in place, drifting up.
    const u = (f - 48) / 35;
    cy = -1.55 + 1.4 * smooth(u);
    spin = u * Math.PI * 2;
  } else {
    // Inverted palette: the world turns black, the apple is light, and an iris
    // wipe closes in on it.
    cy = -0.15;
    invert = true;
    const u = (f - 84) / (CLIP_FRAMES - 85);
    iris = 6 - 4.6 * smooth(u);
  }
  for (let j = 0; j < H; j++) {
    const y = 3 - ((j + 0.5) / H) * 6;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * 8 - 4;
      let ink = apple(x, y, cx, cy, sx * 1.15, sy * 1.15, spin);
      if (invert) ink = !ink && Math.hypot(x, y - cy) < iris;
      data[j * W + i] = ink ? 1 : 0;
    }
  }
  return data;
}

/** Trace + encode the whole clip (deterministic). */
export function buildSilhouetteClip(frames = CLIP_FRAMES): string {
  const out: IPoly[][] = [];
  for (let f = 0; f < frames; f++) {
    out.push(vectorize({ width: CLIP_W, height: CLIP_H, data: silhouetteFrame(f) }, 0.9, 3));
  }
  return encodeClip({ w: 2 * CLIP_W, h: 2 * CLIP_H, fps: CLIP_FPS, box: [-4, -3, 4, 3], frames: out });
}

let cachedClip: string | null = null;

/** Goal 4 (machinery): a frame-sequence entry playing the generated clip. */
export function silhouetteDemo(): GraphData {
  cachedClip ??= buildSilhouetteClip();
  const id = putAsset(cachedClip);
  const E = entryMaker('sil');
  const seconds = CLIP_FRAMES / CLIP_FPS;
  const entries = [
    E('T = 0', '#2d70b3', {
      varMin: 0,
      varMax: seconds,
      varStep: 1 / CLIP_FPS,
      animMode: 'loop',
      animSpeed: 4 / seconds, // real time: a full sweep takes `seconds`
      autoplay: true,
      expanded: true,
    }),
    // The "screen" behind the clip.
    E('((-4, -3), (4, -3), (4, 3), (-4, 3), (-4, -3))', '#3a3f47', {
      fill: true,
      fillOpacity: 1,
      fillColor: '#f6f4ef',
      lineWidth: 2,
    }),
    E(`frames(${CLIP_FPS} T)`, '#111111', { frames: id }),
  ];
  return graph(entries, { tMin: -5.5, tMax: 5.5, yMin: -3.6, yMax: 3.6 }, { [id]: cachedClip });
}
