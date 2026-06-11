/** Derivative of a first-order system: dY/dt = f(t, Y). */
export type DerivFn = (t: number, y: number[]) => number[];

/** One classic fourth-order Runge–Kutta step for a vector state. */
export function rk4Step(f: DerivFn, t: number, y: number[], h: number): number[] {
  const n = y.length;
  const k1 = f(t, y);

  const y2 = new Array<number>(n);
  for (let i = 0; i < n; i++) y2[i] = y[i] + (h / 2) * k1[i];
  const k2 = f(t + h / 2, y2);

  const y3 = new Array<number>(n);
  for (let i = 0; i < n; i++) y3[i] = y[i] + (h / 2) * k2[i];
  const k3 = f(t + h / 2, y3);

  const y4 = new Array<number>(n);
  for (let i = 0; i < n; i++) y4[i] = y[i] + h * k3[i];
  const k4 = f(t + h, y4);

  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return out;
}

export function isFiniteVec(y: number[]): boolean {
  for (let i = 0; i < y.length; i++) if (!Number.isFinite(y[i])) return false;
  return true;
}

export function maxAbs(y: number[]): number {
  let m = 0;
  for (let i = 0; i < y.length; i++) {
    const a = Math.abs(y[i]);
    if (a > m) m = a;
  }
  return m;
}
