import { describe, expect, it } from 'vitest';
import { parse as mjParse } from 'mathjs';
import {
  HELPERS,
  clamp,
  ease,
  keyframes,
  lerp,
  project3,
  pulse,
  rotate3,
  rotx,
  roty,
  smoothstep,
  step,
} from './helpers';
import { KNOWN_FUNCTIONS } from './builtins';

const ev = (expr: string, scope: Record<string, unknown> = {}) =>
  mjParse(expr).compile().evaluate({ ...HELPERS, ...scope });

describe('interpolation helpers', () => {
  it('lerp extrapolates linearly', () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(lerp(2, 4, 1.5)).toBe(5);
  });
  it('clamp bounds a value', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
    expect(clamp(7, 0, 1)).toBe(1);
    expect(ev('clamp(3)')).toBe(1);
  });
  it('smoothstep is 0/1 outside and symmetric in the middle', () => {
    expect(smoothstep(0, 1, -2)).toBe(0);
    expect(smoothstep(0, 1, 3)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625);
    expect(smoothstep(2, 2, 1)).toBe(0);
    expect(smoothstep(2, 2, 3)).toBe(1);
  });
  it('ease is a clamped monotone in-out curve', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    let prev = -1;
    for (let u = 0; u <= 1; u += 0.05) {
      expect(ease(u)).toBeGreaterThanOrEqual(prev);
      prev = ease(u);
    }
  });
  it('step and pulse', () => {
    expect(step(-0.1)).toBe(0);
    expect(step(0)).toBe(1);
    expect(pulse(1, 1, 2)).toBe(1);
    expect(pulse(2, 1, 2)).toBe(0);
    expect(pulse(0.5, 1, 2)).toBe(0);
  });
});

describe('keyframes', () => {
  const k = [0, 0, 2, 10, 3, 4];
  it('holds before the first and after the last key', () => {
    expect(keyframes(-5, k, false)).toBe(0);
    expect(keyframes(0, k, false)).toBe(0);
    expect(keyframes(9, k, false)).toBe(4);
  });
  it('interpolates linearly between keys', () => {
    expect(keyframes(1, k, false)).toBe(5);
    expect(keyframes(2, k, false)).toBe(10);
    expect(keyframes(2.5, k, false)).toBe(7);
  });
  it('smooth mode eases each span but hits the keys exactly', () => {
    expect(keyframes(2, k, true)).toBe(10);
    expect(keyframes(1, k, true)).toBeCloseTo(5);
    expect(keyframes(0.5, k, true)).toBeLessThan(2.5);
  });
  it('rejects malformed pair lists', () => {
    expect(keyframes(1, [], false)).toBeNaN();
    expect(keyframes(1, [0, 1, 2], false)).toBeNaN();
  });
  it('a single key is a constant', () => {
    expect(keyframes(5, [1, 7], false)).toBe(7);
  });
  it('is callable from expressions as keys / skeys', () => {
    expect(ev('keys(T, 0, 0, 2, 10)', { T: 1 })).toBe(5);
    expect(ev('skeys(T, 0, 0, 2, 10)', { T: 2 })).toBe(10);
  });
});

describe('geometry helpers', () => {
  it('rotx/roty rotate a 2D point', () => {
    expect(rotx(1, 0, Math.PI / 2)).toBeCloseTo(0);
    expect(roty(1, 0, Math.PI / 2)).toBeCloseTo(1);
    expect(rotx(0, 1, Math.PI / 2)).toBeCloseTo(-1);
    const a = 0.7;
    expect(Math.hypot(rotx(3, 4, a), roty(3, 4, a))).toBeCloseTo(5);
  });
  it('rotate3 by zero is the identity and preserves length', () => {
    expect(rotate3(1, 2, 3, 0, 0)).toEqual([1, 2, 3]);
    const [x, y, z] = rotate3(1, 2, 3, 0.4, -1.1);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(1, 2, 3));
  });
  it('yaw of π/2 swings +x towards −z', () => {
    const [x, , z] = rotate3(1, 0, 0, Math.PI / 2, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });
  it('orthographic projection drops z', () => {
    expect(project3(1, 2, 5, 0, 0, 0)).toEqual([1, 2]);
    expect(project3(1, 2, 5, 0, 0, Infinity)).toEqual([1, 2]);
  });
  it('perspective makes nearer points bigger and hides points behind the camera', () => {
    const [nearX] = project3(1, 0, 1, 0, 0, 5);
    const [farX] = project3(1, 0, -1, 0, 0, 5);
    expect(nearX).toBeGreaterThan(1);
    expect(farX).toBeLessThan(1);
    expect(project3(1, 0, 6, 0, 0, 5)[0]).toBeNaN();
  });
  it('projx/projy/projz are exposed to expressions', () => {
    expect(ev('projx(1, 2, 3)')).toBe(1);
    expect(ev('projy(1, 2, 3)')).toBe(2);
    expect(ev('projz(1, 2, 3)')).toBe(3);
    expect(ev('rotx(1, 0, pi)')).toBeCloseTo(-1);
  });
  it('every helper is a known function (no "Unknown function" error)', () => {
    for (const name of Object.keys(HELPERS)) expect(KNOWN_FUNCTIONS.has(name)).toBe(true);
  });
});
