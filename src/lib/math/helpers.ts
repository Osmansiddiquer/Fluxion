// Scripting helpers: pure numeric functions exposed to every expression, for
// animation (interpolation, easing, keyframes) and geometry (2D rotation, 3D
// projection). mathjs resolves a called function from the evaluation scope before
// its own namespace, so these are injected as scope members (see compute.ts
// `buildScope`). Everything here is plain arithmetic — no eval, no side effects.

type Fn = (...args: number[]) => number;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

/** Clamp x into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Linear interpolation a → b by u (not clamped, so u outside 0…1 extrapolates). */
export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Hermite smoothstep: 0 below e0, 1 above e1, smooth in between. */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
}

/** Ease-in-out (cubic) of u, clamped to 0…1. */
export function ease(u: number): number {
  const x = clamp(u, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Heaviside step: 1 when x ≥ 0, else 0. */
export function step(x: number): number {
  return x >= 0 ? 1 : 0;
}

/** 1 on the half-open window [a, b), else 0. */
export function pulse(x: number, a: number, b: number): number {
  return x >= a && x < b ? 1 : 0;
}

/**
 * Keyframe interpolation. `keys(T, t0, v0, t1, v1, …)` is the value at time T of
 * a track through the (time, value) pairs — held flat before the first and after
 * the last key. `smooth` eases each span (smoothstep) instead of going linearly.
 * Keys must be listed in increasing time; malformed input yields NaN.
 */
export function keyframes(T: number, pairs: number[], smooth: boolean): number {
  const n = Math.floor(pairs.length / 2);
  if (n === 0 || pairs.length % 2 !== 0) return NaN;
  if (!(T > pairs[0])) return pairs[1];
  for (let i = 0; i < n - 1; i++) {
    const t0 = pairs[2 * i];
    const t1 = pairs[2 * i + 2];
    if (T <= t1) {
      const v0 = pairs[2 * i + 1];
      const v1 = pairs[2 * i + 3];
      if (t1 <= t0) return v1;
      let u = (T - t0) / (t1 - t0);
      if (smooth) u = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * u;
    }
  }
  return pairs[2 * n - 1];
}

/** 2D rotation of (x, y) by angle a: x-component. */
export function rotx(x: number, y: number, a: number): number {
  return x * Math.cos(a) - y * Math.sin(a);
}
/** 2D rotation of (x, y) by angle a: y-component. */
export function roty(x: number, y: number, a: number): number {
  return x * Math.sin(a) + y * Math.cos(a);
}

/**
 * Rotate a 3D point by `yaw` about the vertical (y) axis, then `pitch` about the
 * horizontal (x) axis. Returns [x, y, z] in camera space (z towards the viewer).
 */
export function rotate3(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  return [x1, y2, z2];
}

/**
 * Perspective projection of a 3D point after `rotate3`. The camera sits at
 * z = dist looking down −z; `dist` ≤ 0 or ∞ means orthographic. A point at or
 * behind the camera is NaN (breaks the stroke there).
 */
export function project3(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  dist: number,
): [number, number] {
  const [px, py, pz] = rotate3(x, y, z, yaw, pitch);
  if (!(dist > 0) || !Number.isFinite(dist)) return [px, py];
  const denom = dist - pz;
  if (denom <= 1e-9) return [NaN, NaN];
  const f = dist / denom;
  return [px * f, py * f];
}

/** Names → implementations, injected into every evaluation scope. */
export const HELPERS: Record<string, Fn> = {
  lerp: (a, b, u) => lerp(num(a), num(b), num(u)),
  mix: (a, b, u) => lerp(num(a), num(b), num(u)),
  clamp: (x, lo = 0, hi = 1) => clamp(num(x), num(lo), num(hi)),
  smoothstep: (e0, e1, x) => smoothstep(num(e0), num(e1), num(x)),
  ease: (u) => ease(num(u)),
  step: (x) => step(num(x)),
  pulse: (x, a, b) => pulse(num(x), num(a), num(b)),
  // Step and impulse forcing for ODEs (Laplace-unit notation). heaviside / H / u
  // are the unit step (1 for x ≥ 0). delta is the Dirac impulse: it can't be
  // sampled, so it evaluates to 0 and an ODE applies it as a jump (parse.ts).
  heaviside: (x) => step(num(x)),
  H: (x) => step(num(x)),
  u: (x) => step(num(x)),
  delta: () => 0,
  keys: (T, ...pairs) => keyframes(num(T), pairs.map(num), false),
  skeys: (T, ...pairs) => keyframes(num(T), pairs.map(num), true),
  rotx: (x, y, a) => rotx(num(x), num(y), num(a)),
  roty: (x, y, a) => roty(num(x), num(y), num(a)),
  projx: (x, y, z, yaw = 0, pitch = 0, dist = 0) =>
    project3(num(x), num(y), num(z), num(yaw), num(pitch), num(dist))[0],
  projy: (x, y, z, yaw = 0, pitch = 0, dist = 0) =>
    project3(num(x), num(y), num(z), num(yaw), num(pitch), num(dist))[1],
  projz: (x, y, z, yaw = 0, pitch = 0) =>
    rotate3(num(x), num(y), num(z), num(yaw), num(pitch))[2],
};

export const HELPER_NAMES = Object.keys(HELPERS);
