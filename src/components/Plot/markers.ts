import type { Transform } from '../../lib/geom/transform';
import type { Feature, FeatureKind } from '../../lib/analysis/types';

export interface PlacedMarker {
  f: Feature;
  color: string;
}

const RADIUS = 4.5;

/** A neutral colour for intersection markers (read from theme). */
function intersectionColor(): string {
  const s = getComputedStyle(document.documentElement);
  return s.getPropertyValue('--text').trim() || '#1f2733';
}

function ringColor(): string {
  const s = getComputedStyle(document.documentElement);
  return s.getPropertyValue('--plot-bg').trim() || '#ffffff';
}

export function colorForMarker(m: PlacedMarker): string {
  return m.f.kind === 'intersection' ? intersectionColor() : m.color;
}

export function drawMarkers(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  markers: PlacedMarker[],
): void {
  const ring = ringColor();
  for (const m of markers) {
    const x = tf.tx(m.f.t);
    const y = tf.ty(m.f.y);
    if (x < -8 || x > tf.width + 8 || y < -8 || y > tf.height + 8) continue;
    const color = colorForMarker(m);
    drawDot(ctx, x, y, m.f.kind, color, ring);
  }
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: FeatureKind,
  color: string,
  ring: string,
): void {
  if (kind === 'discontinuity') {
    // Hollow ring.
    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ring;
  ctx.stroke();
}
