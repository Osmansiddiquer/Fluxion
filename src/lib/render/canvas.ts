import { OP, type Mat, type Paint } from '../script/protocol';
import type { Transform } from '../geom/transform';
import type { Effects } from '../style';

/**
 * Canvas primitives shared by the Graph-mode renderer (PlotCanvas) and the
 * Script-mode renderer (scriptLayer): affine matrices, op-coded paths, paints
 * (solid colours and data-space linear / radial gradients), layer transforms,
 * blend / glow / blur effects and the letterbox frame. All inputs are plain
 * data (Script mode's wire format), so either mode can produce them.
 */

/** Data → screen (CSS px) as an affine matrix. */
export function screenMatrix(tf: Transform): Mat {
  const { vp, width, height } = tf;
  const kx = width / (vp.tMax - vp.tMin || 1);
  const ky = height / (vp.yMax - vp.yMin || 1);
  return [kx, 0, 0, -ky, -vp.tMin * kx, height + vp.yMin * ky];
}

/** m · n (apply n first). */
export function mulMat(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMat(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/**
 * A layer transform in data space: scale by `s` and rotate by `angle` (radians,
 * counter-clockwise) about the pivot (cx, cy), then move by (dx, dy).
 */
export function layerMatrix(dx = 0, dy = 0, s = 1, angle = 0, cx = 0, cy = 0): Mat {
  const c = Math.cos(angle) * s;
  const n = Math.sin(angle) * s;
  // p' = R·S·(p − c) + c + d
  return [c, n, -n, c, cx - c * cx + n * cy + dx, cy - n * cx - c * cy + dy];
}

/** Trace op-coded path data (lib/geom/path, Script mode) into the current path. */
export function tracePathOps(ctx: CanvasRenderingContext2D, ops: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < ops.length; ) {
    const op = ops[i];
    switch (op) {
      case OP.move:
        ctx.moveTo(ops[i + 1], ops[i + 2]);
        i += 3;
        break;
      case OP.line:
        ctx.lineTo(ops[i + 1], ops[i + 2]);
        i += 3;
        break;
      case OP.quad:
        ctx.quadraticCurveTo(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4]);
        i += 5;
        break;
      case OP.cubic:
        ctx.bezierCurveTo(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5], ops[i + 6]);
        i += 7;
        break;
      case OP.close:
        ctx.closePath();
        i += 1;
        break;
      case OP.ellipse:
        ctx.ellipse(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5], ops[i + 6], ops[i + 7], ops[i + 8] === 1);
        i += 9;
        break;
      default:
        return;
    }
  }
}

/** A Paint as a canvas fill / stroke style; gradient geometry is in data space,
 * mapped to the screen by `S` (data → CSS px, layer transform included). */
export function paintToCanvas(ctx: CanvasRenderingContext2D, p: Paint, S: Mat): string | CanvasGradient {
  if (typeof p === 'string') return p;
  try {
    let g: CanvasGradient;
    if (p.type === 'linear') {
      const [x0, y0] = applyMat(S, p.x0, p.y0);
      const [x1, y1] = applyMat(S, p.x1, p.y1);
      g = ctx.createLinearGradient(x0, y0, x1, y1);
    } else {
      // Radii scale with the transform's (average) linear scale.
      const k = Math.sqrt(Math.abs(S[0] * S[3] - S[1] * S[2]));
      const [x0, y0] = applyMat(S, p.x0, p.y0);
      const [x1, y1] = applyMat(S, p.x1, p.y1);
      g = ctx.createRadialGradient(x0, y0, p.r0 * k, x1, y1, p.r1 * k);
    }
    for (const s of p.stops) {
      try {
        g.addColorStop(s.offset, s.color);
      } catch {
        /* unparseable colour: skip the stop */
      }
    }
    return g;
  } catch {
    return 'transparent';
  }
}

/**
 * Apply blend / glow / blur for the next fill or stroke. Shadow and filter
 * lengths are in device pixels (not affected by the transform), hence `dpr`.
 * Returns whether anything was set (so the caller knows to reset).
 */
export function applyEffects(ctx: CanvasRenderingContext2D, fx: Effects, dpr: number): boolean {
  let any = false;
  if (fx.blend) {
    ctx.globalCompositeOperation = fx.blend;
    any = true;
  }
  if (fx.glow > 0 && fx.glowColor) {
    ctx.shadowBlur = fx.glow * dpr;
    ctx.shadowColor = fx.glowColor;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    any = true;
  }
  if (fx.blur > 0 && 'filter' in ctx) {
    ctx.filter = `blur(${+(fx.blur * dpr).toFixed(2)}px)`;
    any = true;
  }
  return any;
}

export function resetEffects(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  if ('filter' in ctx) ctx.filter = 'none';
}

/** The largest `aspect` (width / height) rectangle centred in a w × h canvas. */
export function letterboxRect(w: number, h: number, aspect: number | undefined): { x: number; y: number; w: number; h: number } {
  if (!aspect || !(aspect > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w, h };
  if (w / h > aspect) {
    const fw = h * aspect;
    return { x: (w - fw) / 2, y: 0, w: fw, h };
  }
  const fh = w / aspect;
  return { x: 0, y: (h - fh) / 2, w, h: fh };
}
