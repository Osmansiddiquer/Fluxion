import type { Transform } from '../../lib/geom/transform';
import type { CurveResult } from '../../lib/compute';
import type { Entry } from '../../store/types';
import { STEP_METHOD_LABELS } from '../../lib/solver/methods';
import { fmtSig } from '../../lib/format';

/**
 * "Show steps" (Numerics panel): the discrete points of Euler / Heun / RK4 with
 * step h, drawn faintly in the entry's colour over the accurate solution —
 * segments between steps, then a dot per step.
 */
export function drawOdeSteps(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  entries: Entry[],
  results: Map<string, CurveResult>,
  size: { w: number; h: number },
  ring: string,
) {
  for (const entry of entries) {
    if (!entry.visible) continue;
    const st = results.get(entry.id)?.numerics?.steps;
    if (!st || st.ts.length < 1) continue;
    const xs = st.ts.map((t) => tf.tx(t));
    const ys = st.ys.map((y) => tf.ty(y));
    const inView = (i: number) => xs[i] > -20 && xs[i] < size.w + 20 && ys[i] > -20 && ys[i] < size.h + 20;
    ctx.save();
    ctx.strokeStyle = entry.color;
    ctx.fillStyle = entry.color;
    // Segments: the method's straight-line march between steps.
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const far = Math.abs(ys[i]) > 1e6;
      if (i === 0 || far) ctx.moveTo(xs[i], far ? Math.sign(ys[i]) * 1e6 : ys[i]);
      else ctx.lineTo(xs[i], ys[i]);
    }
    ctx.stroke();
    // Dots (small when steps are dense, so a tiny h doesn't paint a solid bar).
    const gap = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 20;
    const r = gap < 5 ? 1.5 : gap < 12 ? 2.25 : 3.25;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = ring;
    for (let i = 0; i < xs.length; i++) {
      if (!inView(i)) continue;
      ctx.beginPath();
      ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
      ctx.fill();
      if (r > 2) ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Trace tooltip line for an ODE with shown steps: the step nearest to t, its
 * value y_h and the global error |y_h − y(t_n)|.
 */
export function stepTip(res: CurveResult | undefined, t: number, sigFigs = 3): string | undefined {
  const st = res?.numerics?.steps;
  if (!st || !st.ts.length) return undefined;
  let best = 0;
  for (let i = 1; i < st.ts.length; i++) if (Math.abs(st.ts[i] - t) < Math.abs(st.ts[best] - t)) best = i;
  // Only when the cursor is near a step (within half a step).
  if (Math.abs(st.ts[best] - t) > st.h * 0.5 + 1e-12) return undefined;
  const f = (v: number) => fmtSig(v, sigFigs);
  return `${STEP_METHOD_LABELS[st.method]} h = ${f(st.h)}: t = ${f(st.ts[best])}, yₕ = ${f(st.ys[best])}, |yₕ − y| = ${f(st.err[best])}`;
}
