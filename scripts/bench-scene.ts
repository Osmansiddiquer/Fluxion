import type { Entry, Viewport } from '../src/store/types';

/**
 * A synthetic "animator" scene modelled on what an agent measured while
 * building a cinematic Fluxion animation: one clock slider T, 22 stacked sky
 * bands, 20 drifting clouds (each a `for` repeat of puffs whose position uses
 * the same `mod(...)` drift term in both coordinates), a stack of sun-glow
 * circles, hero silhouettes as long pre-subdivided polylines, and a waving
 * scarf. Several clouds drift outside the viewport at any moment.
 *
 * Shared by `scripts/bench.ts` (ms per frame) and the engine tests (results
 * must not change when the engine gets faster).
 */
export const BENCH_VIEWPORT: Viewport = { tMin: -16, tMax: 16, yMin: -9, yMax: 9 };

let n = 0;
const e = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `b${n++}`,
  raw,
  color: '#2d70b3',
  visible: true,
  expanded: false,
  ...extra,
});

/** Deterministic pseudo-random numbers (so every run builds the same scene). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `tuned`: give the soft clouds their own low resolution (`samples: 96`). */
export function benchScene(T = 0, tuned = false): Entry[] {
  n = 0;
  const r = rng(7);
  const out: Entry[] = [e(`T = ${T}`, { varMin: 0, varMax: 60, animMode: 'loop' })];
  // Sky: 22 horizontal bands.
  for (let i = 0; i < 22; i++) {
    const y0 = -9 + i * (18 / 22);
    const y1 = y0 + 18 / 22 + 0.01;
    out.push(
      e(`((-16, ${y0.toFixed(3)}), (16, ${y0.toFixed(3)}), (16, ${y1.toFixed(3)}), (-16, ${y1.toFixed(3)}))`, {
        fill: true,
        fillOpacity: 1,
        lineWidth: 0,
        fillColor: `rgb(${20 + i * 9}, ${40 + i * 6}, ${120 - i * 3})`,
      }),
    );
  }
  // Sun glow: 5 stacked circles pulsing with T.
  for (let i = 0; i < 5; i++) {
    out.push(
      e(`((${1 + i * 0.6} + 0.05*sin(2T))*cos(t) + 6, (${1 + i * 0.6} + 0.05*sin(2T))*sin(t) + 4)`, {
        fill: true,
        fillOpacity: 0.2,
        lineWidth: 0,
      }),
    );
  }
  // 20 clouds, each 4 puffs; the drift term is repeated in x and y.
  for (let c = 0; c < 20; c++) {
    const sp = (0.2 + r() * 0.6).toFixed(3);
    const ph = (r() * 40).toFixed(3);
    const h = (2 + r() * 6).toFixed(3);
    const s = (0.6 + r() * 0.8).toFixed(3);
    out.push(
      e(
        `(${s}*(1 + 0.15*sin(3t + k))*cos(t) + mod(T*${sp} + ${ph}, 48) - 24 + 1.1*k*${s}, ` +
          `0.6*${s}*(1 + 0.15*sin(3t + k))*sin(t) + ${h} + 0.3*sin(mod(T*${sp} + ${ph}, 48)/3) + 0.25*mod(k, 2)) for k = 0..3`,
        { fill: true, fillOpacity: 0.9, lineWidth: 0, fillColor: '#ffffff', ...(tuned ? { samples: 96 } : {}) },
      ),
    );
  }
  // Hero silhouettes: pre-subdivided polylines (~120 points each).
  for (let h = 0; h < 8; h++) {
    const pts: string[] = [];
    const x0 = -15 + h * 4;
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const x = x0 + u * 3;
      const y = -9 + 3 + Math.sin(u * Math.PI) * (2 + Math.sin(u * 17 + h) * 0.4);
      pts.push(`(${x.toFixed(3)}, ${y.toFixed(3)})`);
    }
    pts.push(`(${(x0 + 3).toFixed(3)}, -9)`, `(${x0.toFixed(3)}, -9)`);
    out.push(e(`(${pts.join(', ')})`, { fill: true, fillOpacity: 1, lineWidth: 1, color: '#000000' }));
  }
  // A waving scarf (parametric over a short t-range).
  out.push(
    e('(t - 2, 0.4*sin(3t - 4T) + 0.1*sin(7t - 6T) - 1)', { thetaMin: 0, thetaMax: 3, lineWidth: 6 }),
    e('(t - 2, 0.4*sin(3t - 4T) + 0.1*sin(7t - 6T) - 1.4)', { thetaMin: 0, thetaMax: 3, lineWidth: 6 }),
  );
  // A plain function of T for good measure (rolling hills).
  out.push(e('y = 0.6*sin(0.5x + 0.2T) - 5'));
  return out;
}
