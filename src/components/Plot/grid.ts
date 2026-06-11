import { formatTick, niceTicks, type Transform } from '../../lib/geom/transform';

export interface GridColors {
  bg: string;
  panelBg: string;
  minor: string;
  major: string;
  axis: string;
  axisText: string;
}

export function readGridColors(): GridColors {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    s.getPropertyValue(name).trim() || fallback;
  return {
    bg: get('--plot-bg', '#ffffff'),
    // Projection panels sit on the recessed chrome tone, not the white canvas.
    panelBg: get('--surface-sunken', '#f7f9fb'),
    minor: get('--grid-minor', '#eef1f5'),
    major: get('--grid-major', '#d8dee7'),
    axis: get('--axis', '#8a95a3'),
    axisText: get('--axis-text', '#6b7686'),
  };
}

/**
 * Draw a readable grid: faint minor lines, stronger major lines on "nice"
 * numbers, bold axes through the origin, and tick labels along each axis.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  colors: GridColors,
): void {
  const { width, height, vp } = tf;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  // Aim for ~ one major line every 80px.
  const tTicks = niceTicks(vp.tMin, vp.tMax, Math.max(2, Math.round(width / 80)));
  const yTicks = niceTicks(vp.yMin, vp.yMax, Math.max(2, Math.round(height / 70)));

  // Minor lines: 5 subdivisions of each major step.
  drawMinor(ctx, tf, colors, tTicks.step, yTicks.step);

  // Major lines.
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.major;
  ctx.beginPath();
  for (const t of tTicks.values) {
    const x = Math.round(tf.tx(t)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (const y of yTicks.values) {
    const py = Math.round(tf.ty(y)) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();

  // Axes.
  const x0 = tf.tx(0);
  const y0 = tf.ty(0);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (y0 >= 0 && y0 <= height) {
    const py = Math.round(y0) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  if (x0 >= 0 && x0 <= width) {
    const px = Math.round(x0) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
  }
  ctx.stroke();

  drawLabels(ctx, tf, colors, tTicks, yTicks);
}

function drawMinor(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  colors: GridColors,
  tStep: number,
  yStep: number,
): void {
  const { width, height, vp } = tf;
  const minorT = tStep / 5;
  const minorY = yStep / 5;
  ctx.strokeStyle = colors.minor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startT = Math.ceil(vp.tMin / minorT) * minorT;
  for (let t = startT, i = 0; t <= vp.tMax && i < 5000; t += minorT, i++) {
    const x = Math.round(tf.tx(t)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  const startY = Math.ceil(vp.yMin / minorY) * minorY;
  for (let y = startY, i = 0; y <= vp.yMax && i < 5000; y += minorY, i++) {
    const py = Math.round(tf.ty(y)) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  colors: GridColors,
  tTicks: ReturnType<typeof niceTicks>,
  yTicks: ReturnType<typeof niceTicks>,
): void {
  const { width, height } = tf;
  ctx.fillStyle = colors.axisText;
  ctx.font = '11px -apple-system, "Segoe UI", system-ui, sans-serif';

  // t labels along the x-axis (clamped to stay on screen).
  const y0 = clamp(tf.ty(0), 12, height - 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of tTicks.values) {
    if (t === 0) continue;
    const x = tf.tx(t);
    if (x < 14 || x > width - 4) continue;
    ctx.fillText(formatTick(t, tTicks.step), x, y0 + 4);
  }

  // y labels along the y-axis.
  const x0 = clamp(tf.tx(0), 4, width - 4);
  ctx.textAlign = x0 > width - 40 ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const offset = x0 > width - 40 ? -6 : 6;
  for (const y of yTicks.values) {
    if (y === 0) continue;
    const py = tf.ty(y);
    if (py < 8 || py > height - 8) continue;
    ctx.fillText(formatTick(y, yTicks.step), x0 + offset, py);
  }

  // Origin label.
  if (tf.tx(0) > 10 && tf.tx(0) < width && tf.ty(0) > 0 && tf.ty(0) < height - 10) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0', tf.tx(0) - 4, tf.ty(0) + 4);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
