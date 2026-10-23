import type { GraphData } from '../graphFile';
import { encodeClip, type IPoly } from '../frames/codec';
import { vectorize } from '../frames/trace';
import { clipGraph } from '../frames/clipGraph';

/**
 * A short, procedurally generated black-and-white silhouette clip in the
 * spirit of "Bad Apple!!" (no copyrighted frames): an apple drops in and
 * bounces, spins, then the palette inverts behind a closing iris wipe.
 * Every frame is rasterised, traced into contours and encoded exactly like an
 * imported clip (scripts/frames-import.ts), so this exercises the full path.
 */
export const CLIP_W = 192;
export const CLIP_H = 144;
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
  // Body: two overlapping lobes (a dimple top and bottom where they meet).
  const body = Math.hypot((u - 0.34) / 0.95, v + 0.02) < 0.74 || Math.hypot((u + 0.34) / 0.95, v + 0.02) < 0.74;
  const notch = Math.hypot(u / 1.4, v - 0.86) < 0.16;
  // Stem (a slightly leaning bar) and a leaf (a rotated ellipse).
  const stem = Math.abs(u - 0.05 - 0.22 * (v - 0.62)) < 0.055 && v > 0.55 && v < 1.12;
  const lu = u - 0.36;
  const lv = v - 0.98;
  const c = Math.cos(0.5);
  const s = Math.sin(0.5);
  const leaf = ((lu * c + lv * s) / 0.3) ** 2 + ((-lu * s + lv * c) / 0.11) ** 2 < 1;
  return (body && !notch) || stem || leaf;
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
    out.push(vectorize({ width: CLIP_W, height: CLIP_H, data: silhouetteFrame(f) }, 1.1, 3));
  }
  return encodeClip({ w: 2 * CLIP_W, h: 2 * CLIP_H, fps: CLIP_FPS, box: [-4, -3, 4, 3], frames: out });
}

let cachedClip: string | null = null;

/** Goal 4 (machinery): a frame-sequence entry playing the generated clip. */
export function silhouetteDemo(): GraphData {
  cachedClip ??= buildSilhouetteClip();
  return clipGraph(cachedClip, { idPrefix: `sil${Date.now().toString(36)}${(n++).toString(36)}` });
}
let n = 0;
