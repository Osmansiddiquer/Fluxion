import type { Transform } from '../../lib/geom/transform';
import type { CurveResult } from '../../lib/compute';
import type { Equilibrium } from '../../lib/analysis/equilibria';
import type { IcTarget } from '../../lib/ode/view';
import { parseColorLiteral, type RGBA } from '../../lib/color';

/**
 * Drawing for the ODE qualitative view (lib/ode): slope / vector fields,
 * nullclines, equilibrium lines and markers, extra solutions, family ghosts
 * and the draggable initial-condition dot. Everything is faint by default and
 * a little stronger while its row is focused (hovered in the sidebar or being
 * dragged), so the curves stay the subject.
 */

export interface OdeItem {
  id: string;
  res: CurveResult;
  /** Solid stroke colour of the entry. */
  color: string;
  lineWidth: number;
  focused: boolean;
}

/** Parse a CSS colour (`#hex` / `rgb()` / `rgba()`) to RGBA; null if unknown. */
export function parseCss(c: string): RGBA | null {
  const lit = parseColorLiteral(c);
  if (lit) return lit;
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(c.trim());
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

/** Mix two colours (t = 0 → a, 1 → b) to a CSS rgba string with alpha `alpha`. */
export function mixCss(a: string, b: string, t: number, alpha = 1): string {
  const ca = parseCss(a) ?? { r: 128, g: 128, b: 128, a: 1 };
  const cb = parseCss(b) ?? ca;
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgba(${m(ca.r, cb.r)}, ${m(ca.g, cb.g)}, ${m(ca.b, cb.b)}, ${alpha})`;
}

/**
 * Colour of family ghost u ∈ [0, 1]: a ramp from a pale tint of the entry
 * colour (mixed towards the background) to the full colour, so the sweep
 * reads in order in both themes.
 */
export function rampColor(color: string, bg: string, u: number): string {
  return mixCss(color, bg, 0.62 * (1 - u) + 0.08, 0.85);
}

function tracePolyline(ctx: CanvasRenderingContext2D, tf: Transform, seg: [number, number][]) {
  for (let i = 0; i < seg.length; i++) {
    const x = tf.tx(seg[i][0]);
    const y = tf.ty(seg[i][1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Fields, nullclines, equilibrium lines, family ghosts and extra solutions (under the curves). */
export function drawOdeUnderlay(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  items: OdeItem[],
  bg: string,
  showEquilibria: boolean,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (const it of items) {
    const ode = it.res.ode;
    // Family ghosts first (the faintest layer).
    if (it.res.ghosts) {
      ctx.lineWidth = Math.max(1, it.lineWidth * 0.6);
      ctx.setLineDash([]);
      for (const g of it.res.ghosts) {
        ctx.strokeStyle = rampColor(it.color, bg, g.u);
        ctx.beginPath();
        for (const seg of g.curve.segments) tracePolyline(ctx, tf, seg);
        ctx.stroke();
      }
    }
    if (!ode) continue;
    const field = ode.field;
    if (field) {
      const L = tf.tx(field.spacing) - tf.tx(0);
      const half = Math.max(3, Math.min(14, L * 0.34));
      ctx.strokeStyle = it.color;
      ctx.fillStyle = it.color;
      ctx.globalAlpha = it.focused ? 0.55 : 0.3;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      const d = field.data;
      const heads: number[] = [];
      for (let i = 0; i < field.count; i++) {
        const o = i * 5;
        const cx = tf.tx(d[o]);
        const cy = tf.ty(d[o + 1]);
        const ux = d[o + 2];
        const uy = -d[o + 3]; // screen y points down
        if (ux === 0 && uy === 0) continue;
        if (field.kind === 'slope') {
          ctx.moveTo(cx - ux * half, cy - uy * half);
          ctx.lineTo(cx + ux * half, cy + uy * half);
        } else {
          // Arrow from the grid point's tail to its head.
          const hx = cx + ux * half;
          const hy = cy + uy * half;
          ctx.moveTo(cx - ux * half, cy - uy * half);
          ctx.lineTo(hx, hy);
          heads.push(hx, hy, ux, uy);
        }
      }
      ctx.stroke();
      if (heads.length) {
        const a = Math.max(2.2, half * 0.42);
        ctx.beginPath();
        for (let i = 0; i < heads.length; i += 4) {
          const [hx, hy, ux, uy] = [heads[i], heads[i + 1], heads[i + 2], heads[i + 3]];
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - ux * a - uy * a * 0.55, hy - uy * a + ux * a * 0.55);
          ctx.lineTo(hx - ux * a + uy * a * 0.55, hy - uy * a - ux * a * 0.55);
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (ode.nullclines) {
      ctx.strokeStyle = it.color;
      ctx.globalAlpha = it.focused ? 0.8 : 0.55;
      ctx.lineWidth = 1.4;
      for (const nc of ode.nullclines) {
        // Each nullcline as ONE path so the dash phase runs across the
        // marching-squares pieces. Long dashes: horizontal rate = 0; dots: vertical.
        ctx.setLineDash(nc.which === 0 ? [7, 5] : [2, 4]);
        ctx.beginPath();
        for (const seg of nc.segments) tracePolyline(ctx, tf, seg);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (showEquilibria && ode.equilibria?.mode === 'lines') {
      ctx.strokeStyle = it.color;
      ctx.globalAlpha = it.focused ? 0.6 : 0.38;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (const e of ode.equilibria.list) {
        const y = Math.round(tf.ty(e.point[0])) + 0.5;
        if (y < -2 || y > tf.height + 2) continue;
        ctx.moveTo(0, y);
        ctx.lineTo(tf.width, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (ode.extras) {
      ctx.strokeStyle = it.color;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1, it.lineWidth * 0.55);
      ctx.beginPath();
      for (const c of ode.extras) for (const seg of c.segments) tracePolyline(ctx, tf, seg);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** A placed equilibrium marker (screen position + data). */
export interface EqMarker {
  x: number;
  y: number;
  eq: Equilibrium;
  color: string;
  entryId: string;
  /** Plot coordinates of the point (horizontal, vertical). */
  data: [number, number];
  /** Labels of the state axes (for the tooltip coordinates). */
  labels: [string, string] | null;
}

/** Equilibrium markers on screen: points in the phase plane, left-edge tabs on y = c lines. */
export function placeEquilibria(tf: Transform, items: OdeItem[]): EqMarker[] {
  const out: EqMarker[] = [];
  for (const it of items) {
    const eqs = it.res.ode?.equilibria;
    if (!eqs || !eqs.list.length) continue;
    const ph = it.res.ode!.phase;
    for (const eq of eqs.list) {
      if (eqs.mode === 'points' && ph) {
        // State order → plotted axes.
        const p = [eq.point[0], eq.point[1]];
        const [a, b] = ph.axes[0] === 0 ? [p[0], p[1]] : [p[1], p[0]];
        out.push({ x: tf.tx(a), y: tf.ty(b), eq, color: it.color, entryId: it.id, data: [a, b], labels: ph.labels });
      } else if (eqs.mode === 'lines') {
        out.push({ x: 16, y: tf.ty(eq.point[0]), eq, color: it.color, entryId: it.id, data: [tf.ix(16), eq.point[0]], labels: null });
      }
    }
  }
  return out.filter((m) => m.x > -10 && m.x < tf.width + 10 && m.y > -10 && m.y < tf.height + 10);
}

const EQ_R = 5.5;

/**
 * Draw equilibrium markers: filled = stable, hollow = unstable, half-filled =
 * saddle (or semi-stable), ring with a centre dot = centre, dashed ring = degenerate.
 */
export function drawEquilibria(ctx: CanvasRenderingContext2D, markers: EqMarker[], ring: string): void {
  ctx.save();
  for (const m of markers) {
    const { x, y, color } = m;
    const s = m.eq.stability;
    ctx.setLineDash([]);
    // Backing disc so the marker reads on top of curves.
    ctx.beginPath();
    ctx.arc(x, y, EQ_R + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (s === 'stable') {
      ctx.beginPath();
      ctx.arc(x, y, EQ_R, 0, Math.PI * 2);
      ctx.fill();
    } else if (s === 'saddle' || s === 'semi-stable') {
      ctx.beginPath();
      ctx.arc(x, y, EQ_R, Math.PI / 2, (Math.PI * 3) / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, EQ_R, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s === 'neutral') {
      ctx.beginPath();
      ctx.arc(x, y, EQ_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      if (s === 'degenerate') ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath();
      ctx.arc(x, y, EQ_R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A draggable initial-condition dot. */
export interface IcDot {
  entryId: string;
  x: number;
  y: number;
  data: [number, number];
  color: string;
  target: IcTarget;
}

export function placeIcDots(tf: Transform, items: OdeItem[]): IcDot[] {
  const out: IcDot[] = [];
  for (const it of items) {
    const ic = it.res.ode?.ic;
    if (!ic || !Number.isFinite(ic.pos[0]) || !Number.isFinite(ic.pos[1])) continue;
    const x = tf.tx(ic.pos[0]);
    const y = tf.ty(ic.pos[1]);
    if (x < -10 || x > tf.width + 10 || y < -10 || y > tf.height + 10) continue;
    out.push({ entryId: it.id, x, y, data: ic.pos, color: it.color, target: ic.target });
  }
  return out;
}

/** IC dots: a small dot with a soft halo (grabbable), larger while active. */
export function drawIcDots(ctx: CanvasRenderingContext2D, dots: IcDot[], ring: string, activeId: string | null): void {
  for (const d of dots) {
    const active = d.entryId === activeId;
    const r = active ? 5.5 : 4.5;
    ctx.beginPath();
    ctx.arc(d.x, d.y, r + 4.5, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.globalAlpha = active ? 0.22 : 0.13;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.lineWidth = 2.25;
    ctx.strokeStyle = d.color;
    ctx.stroke();
  }
}

/** Phase-plane axis names at the ends of the axes (or the plot edges). */
export function drawAxisNames(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  labels: [string, string],
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = 'italic 600 13px "Times New Roman", Georgia, serif';
  const y0 = Math.max(14, Math.min(tf.height - 8, tf.ty(0)));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(labels[0], tf.width - 8, y0 - 5);
  // Tick labels sit right of the vertical axis: put its name on the left.
  const ax = tf.tx(0);
  ctx.textBaseline = 'top';
  if (ax > 28 && ax <= tf.width - 4) {
    ctx.textAlign = 'right';
    // Clear of the slice cursor's handle, which often sits on this axis.
    ctx.fillText(labels[1], ax - 15, 6);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(labels[1], Math.max(8, Math.min(tf.width - 30, ax)) + 7, 22);
  }
  ctx.restore();
}
