/**
 * Render the plot canvas to a tiny image for the saved-graphs list. Best effort:
 * returns undefined whenever it can't (node / tests, no canvas, a tainted or
 * zero-sized canvas, no 2D context) — a missing thumbnail just shows a placeholder.
 */

// 2× the largest displayed size (120×75 CSS px), so it's crisp on HiDPI screens.
export const THUMB_W = 240;
export const THUMB_H = 150;

interface CanvasLike {
  width: number;
  height: number;
}

interface Env {
  document?: { createElement(tag: 'canvas'): HTMLCanvasElement; querySelector?(sel: string): Element | null };
}

/** Scale `src` to cover a THUMB_W×THUMB_H frame (centre-cropped) and encode it. */
export function makeThumbnail(src: CanvasLike | null | undefined, env: Env = globalThis as Env): string | undefined {
  try {
    const doc = env.document;
    if (!src || !doc || !(src.width > 0) || !(src.height > 0)) return undefined;
    const out = doc.createElement('canvas');
    out.width = THUMB_W;
    out.height = THUMB_H;
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    const scale = Math.max(THUMB_W / src.width, THUMB_H / src.height);
    const sw = THUMB_W / scale;
    const sh = THUMB_H / scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Downscaling thins 1–2 px curves to faint hairlines; a little contrast keeps them legible.
    if ('filter' in ctx) ctx.filter = 'contrast(1.35) saturate(1.25)';
    ctx.drawImage(
      src as CanvasImageSource,
      (src.width - sw) / 2,
      (src.height - sh) / 2,
      sw,
      sh,
      0,
      0,
      THUMB_W,
      THUMB_H,
    );
    // WebP is ~3× smaller than PNG; browsers without it return a PNG data URL.
    const url = out.toDataURL('image/webp', 0.72);
    return typeof url === 'string' && url.startsWith('data:image/') && url.length > 30 ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Thumbnail of the main plot currently on screen (if any). */
export function thumbnailOfPlot(env: Env = globalThis as Env): string | undefined {
  try {
    const c = env.document?.querySelector?.('.plot-canvas') as HTMLCanvasElement | null | undefined;
    return makeThumbnail(c, env);
  } catch {
    return undefined;
  }
}
