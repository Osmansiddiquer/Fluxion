import type { DisplayItem, ItemStyle, Mat, ScriptFrame } from '../../lib/script/protocol';
import { mulMat, paintToCanvas, screenMatrix, tracePathOps } from '../../lib/render/canvas';
import type { Transform } from '../../lib/geom/transform';
import type { FrameSequence } from '../../lib/frames/codec';

/**
 * Draw a Script mode display list (already validated by protocol.ts) on the
 * plot canvas. Shapes are in data coordinates: paths carry their own affine
 * matrix, which is composed with the data→screen transform for building the
 * path; strokes are then drawn in screen space, so line widths and dashes are
 * in px at any zoom.
 */

const FONTS = {
  sans: "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
} as const;

// Matrices, paths and paints are shared with the Graph-mode renderer.
export { screenMatrix };
const mul = mulMat;
const tracePath = tracePathOps;
const paintStyle = paintToCanvas;

function fillStroke(ctx: CanvasRenderingContext2D, st: ItemStyle, S: Mat, dpr: number, evenodd = false): void {
  // Paint in screen space (px line widths, gradients mapped by S).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = st.opacity;
  if (st.fill) {
    ctx.fillStyle = paintStyle(ctx, st.fill, S);
    if (evenodd) ctx.fill('evenodd');
    else ctx.fill();
  }
  if (st.stroke && st.width > 0) {
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = st.width;
    ctx.lineCap = st.cap;
    ctx.lineJoin = st.join;
    ctx.setLineDash(st.dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function setMatrix(ctx: CanvasRenderingContext2D, m: Mat, dpr: number): boolean {
  if (!m.every(Number.isFinite)) return false;
  ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
  return true;
}

export function drawScriptBackground(ctx: CanvasRenderingContext2D, frame: ScriptFrame, w: number, h: number): boolean {
  if (!frame.background) return false;
  ctx.fillStyle = frame.background;
  ctx.fillRect(0, 0, w, h);
  return true;
}

export function drawScriptLayer(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  frame: ScriptFrame,
  getClip: (id: string) => FrameSequence | null,
  dpr: number,
  haloColor: string,
): void {
  const S = screenMatrix(tf);
  const pt = (x: number, y: number): [number, number] => [S[0] * x + S[2] * y + S[4], S[1] * x + S[3] * y + S[5]];
  ctx.save();
  for (const it of frame.items as DisplayItem[]) {
    switch (it.k) {
      case 'path': {
        if (!setMatrix(ctx, mul(S, it.m), dpr)) break;
        tracePath(ctx, it.ops);
        fillStroke(ctx, it.style, S, dpr);
        break;
      }
      case 'clip': {
        const seq = getClip(it.id);
        if (!seq) break;
        if (!setMatrix(ctx, mul(S, it.m), dpr)) break;
        ctx.beginPath();
        for (const poly of seq.frameInData(it.frame)) {
          for (let i = 0; i < poly.length; i++) {
            if (i === 0) ctx.moveTo(poly[i][0], poly[i][1]);
            else ctx.lineTo(poly[i][0], poly[i][1]);
          }
          ctx.closePath();
        }
        fillStroke(ctx, it.style, S, dpr, true);
        break;
      }
      case 'point': {
        const [x, y] = pt(it.x, it.y);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(x, y, it.r, 0, Math.PI * 2);
        fillStroke(ctx, it.style, S, dpr);
        break;
      }
      case 'arrow': {
        const [x1, y1] = pt(it.x1, it.y1);
        const [x2, y2] = pt(it.x2, it.y2);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (!(len > 0)) break;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const head = Math.min(it.head, len * 0.6);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Shaft stops at the head's base so a thick line doesn't poke through.
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - ux * head * 0.8, y2 - uy * head * 0.8);
        fillStroke(ctx, { ...it.style, fill: null }, S, dpr);
        const color = it.style.stroke ?? (typeof it.style.fill === 'string' ? it.style.fill : null);
        if (color) {
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - ux * head - uy * head * 0.45, y2 - uy * head + ux * head * 0.45);
          ctx.lineTo(x2 - ux * head + uy * head * 0.45, y2 - uy * head - ux * head * 0.45);
          ctx.closePath();
          ctx.globalAlpha = it.style.opacity;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'text': {
        const [x, y] = pt(it.x, it.y);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(x + (it.halo ? 6 : 0), y - (it.halo ? 4 : 0));
        if (it.angle) ctx.rotate(-it.angle);
        ctx.font = `${it.bold ? '650 ' : ''}${it.size}px ${FONTS[it.font]}`;
        ctx.textAlign = it.align;
        ctx.textBaseline = it.baseline;
        ctx.globalAlpha = it.style.opacity;
        if (it.halo) {
          ctx.lineWidth = 3.5;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = haloColor;
          ctx.strokeText(it.text, 0, 0);
        }
        if (it.style.stroke) {
          ctx.lineWidth = it.style.width;
          ctx.strokeStyle = it.style.stroke;
          ctx.strokeText(it.text, 0, 0);
        }
        if (it.style.fill) {
          ctx.fillStyle = paintStyle(ctx, it.style.fill, S);
          ctx.fillText(it.text, 0, 0);
        }
        ctx.globalAlpha = 1;
        break;
      }
    }
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
