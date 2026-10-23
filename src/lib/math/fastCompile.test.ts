import { describe, expect, it } from 'vitest';
import { parse as mjParse } from 'mathjs';
import { fastCompile } from './fastCompile';
import { normalizeInput } from './normalize';
import { HELPERS } from './helpers';
import { parseEntry } from './parse';
import { nodesOf } from '../compute';
import { buildEvalContext } from '../scope';
import { EXPRESSION_DEMOS as DEMOS } from '../demos';

/** Same value, treating NaN = NaN and comparing complex / matrices by string. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a !== typeof b) return false;
  if (a && typeof a === 'object') return String(a) === String(b);
  return a === b;
}

const compiledCache = new Map<string, { fast: ReturnType<typeof fastCompile>; slow: ReturnType<typeof fastCompile> }>();
function evalBoth(expr: string, scope: Record<string, unknown>) {
  let c = compiledCache.get(expr);
  if (!c) {
    const node = mjParse(normalizeInput(expr));
    c = { fast: fastCompile(node), slow: node.compile() };
    compiledCache.set(expr, c);
  }
  const { fast, slow } = c;
  let s: unknown;
  let f: unknown;
  let sErr: string | null = null;
  let fErr: string | null = null;
  try {
    s = slow.evaluate({ ...scope });
  } catch (e) {
    sErr = (e as Error).message;
  }
  try {
    f = fast.evaluate({ ...scope });
  } catch (e) {
    fErr = (e as Error).message;
  }
  return { s, f, sErr, fErr };
}

const EDGE = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, 1e-9, -1e-9, 0.9999999999999, 1.0000000000001, 2.9999999999999996,
  47.99999999999, 48, -48, 1e12, -1e12, Infinity, -Infinity, NaN, Math.PI, -Math.PI, 0.1 + 0.2, 7 / 3];

describe('fastCompile: native functions match mathjs exactly', () => {
  const unary = ['sin', 'cos', 'tan', 'atan', 'exp', 'abs', 'sinh', 'cosh', 'tanh', 'sqrt', 'log', 'asin', 'acos', 'floor', 'ceil'];
  let seed = 3;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const vals = [...EDGE, ...Array.from({ length: 300 }, () => (rnd() - 0.5) * 10 ** Math.floor(rnd() * 8 - 3))];
  for (const fn of unary) {
    it(fn, () => {
      for (const v of vals) {
        const { s, f, sErr, fErr } = evalBoth(`${fn}(a)`, { a: v });
        expect(fErr, `${fn}(${v})`).toBe(sErr);
        expect(same(f, s), `${fn}(${v}) fast=${String(f)} mathjs=${String(s)}`).toBe(true);
      }
    });
  }
  it('mod, atan2, pow and the arithmetic operators', () => {
    for (const a of vals.slice(0, 120)) {
      for (const b of [...EDGE, 7, -7, 0.3, 48, 2.5]) {
        for (const expr of ['mod(a, b)', 'a mod b', 'atan2(a, b)', 'a ^ b', 'a + b', 'a - b', 'a * b', 'a / b', '-a', 'a > b ? a : b']) {
          const { s, f, sErr, fErr } = evalBoth(expr, { a, b });
          expect(fErr, `${expr} a=${a} b=${b}`).toBe(sErr);
          expect(same(f, s), `${expr} a=${a} b=${b} fast=${String(f)} mathjs=${String(s)}`).toBe(true);
        }
      }
    }
  });
});

describe('fastCompile: expressions match mathjs', () => {
  const CORPUS = [
    '3sin(2t) + e^(-t/4)', 'sqrt(abs(t))', 'sin(t)^2', 'floor(t) + ceil(-t)', '1/(t - 1)', 't!', 'gamma(t)',
    '(-8)^(1/3)', 'abs(sqrt(-4))', 'sqrt(t) + 1', 'log(t, 2)', 'log10(t) + log2(t)', 'nthRoot(t, 3)', 'cbrt(t)',
    'max(t, 0)^2', 'min(t, 1, 2)', 'hypot(t, y)', 'sign(t)', 'round(t)', 'round(t*2.5)', 'mod(t*0.3 + 7, 48) - 24',
    't > 0 ? t : -t', 't > 0 and y > 0', 'not (t > 1)', 't == y', 't != 2', '[1, 2, 3][2] * t', 'sec(t) + csc(t) + cot(t)',
    'asin(t) + acos(t/3)', 'asinh(t) + acosh(t) + atanh(t/9)', 'sinc(t)', 'fix(t)', 'pi*t + tau + phi', 'i*t', 'e^(i*t)',
    'lerp(1, 3, t)', 'skeys(t, 0, 1, 2, 3)', 'rotx(2, t, 0.5) + roty(y, 1, t)', 'projx(t, y, 1, 0.3, 0.2, 6)',
    'clamp(t, -1, 1) + smoothstep(0, 1, t) + ease(t) + step(t) + pulse(t, 0, 1)',
    'mod(T*0.4 + 3k, 48) + mod(T*0.4 + 3k, 48)/48', 'sin(3t + k) * cos(t) + sin(3t + k)', 'y - t^2', '(t^2 + y^2 - 1)^3 - t^2*y^3',
    'undefinedName + 1', 'sin()', 'sin(1, 2)', 'true + 1', 'k*true', '2(3) + t(4)',
  ];
  const scope = { ...HELPERS, T: 3.7, k: 2 } as Record<string, unknown>;
  for (const expr of CORPUS) {
    it(expr, () => {
      for (const t of [-3.3, -1, -0.5, 0, 0.5, 1, 2, 3.14159, 7.5]) {
        for (const y of [-2, 0, 0.7]) {
          const { s, f, sErr, fErr } = evalBoth(expr, { ...scope, t, y });
          expect(fErr, `${expr} @ t=${t}`).toBe(sErr);
          expect(same(f, s), `${expr} @ t=${t},y=${y}: fast=${String(f)} mathjs=${String(s)}`).toBe(true);
        }
      }
    });
  }
});

describe('fastCompile: every demo expression evaluates exactly as before', () => {
  for (const demo of DEMOS) {
    it(demo.id, () => {
      const g = demo.build();
      const items = g.entries.map((entry) => ({ entry, parsed: parseEntry(entry.raw) }));
      const { scope } = buildEvalContext(items);
      let checked = 0;
      for (const { parsed } of items) {
        const loops = parsed.kind === 'repeat' ? parsed.loops.map((l) => l.name) : [];
        for (const node of nodesOf(parsed)) {
          const fast = fastCompile(node);
          const slow = node.compile();
          for (const t of [0, 0.4, 1.3, 2.9, 5.1]) {
            const sc: Record<string, unknown> = { ...scope, t, y: 0.3, r: 1.1, θ: t, theta: t };
            for (const l of loops) sc[l] = 1;
            let s: unknown;
            let f: unknown;
            try {
              s = slow.evaluate({ ...sc });
            } catch {
              s = 'throws';
            }
            try {
              f = fast.evaluate({ ...sc });
            } catch {
              f = 'throws';
            }
            expect(same(f, s), `${node.toString()} @ t=${t}`).toBe(true);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('fastCompile: hoisting', () => {
  it('evaluates an invariant call once per sweep, and again when its inputs change', () => {
    let calls = 0;
    const drift = (v: number) => {
      calls++;
      return v * 2;
    };
    const node = mjParse('drift(T + k) + t');
    const ev = fastCompile(node);
    const s: Record<string, unknown> = { drift, T: 1, k: 2, t: 0 };
    for (let i = 0; i < 100; i++) {
      s.t = i;
      expect(ev.evaluate(s)).toBe(6 + i);
    }
    expect(calls).toBe(1);
    s.T = 2; // the clock moved: recomputed
    expect(ev.evaluate(s)).toBe(8 + 99);
    expect(calls).toBe(2);
    // A new scope object with the same values still hits (repeat copies).
    expect(ev.evaluate({ drift, T: 2, k: 2, t: 1 })).toBe(9);
    expect(calls).toBe(2);
    // A different function value (a rebuilt user function) misses.
    const drift2 = (v: number) => v * 3;
    expect(ev.evaluate({ drift: drift2, T: 2, k: 2, t: 1 })).toBe(13);
  });

  it('never hoists over the sample variables', () => {
    let calls = 0;
    const g = (v: number) => (calls++, v);
    const ev = fastCompile(mjParse('g(t) + g(y) + g(theta)'));
    const s: Record<string, unknown> = { g, t: 0, y: 0, theta: 0 };
    for (let i = 0; i < 10; i++) {
      s.t = i;
      s.y = -i;
      s.theta = 2 * i;
      expect(ev.evaluate(s)).toBe(i - i + 2 * i);
    }
    expect(calls).toBe(30);
  });

  it('respects extra varying names (ODE state, function parameters)', () => {
    const ev = fastCompile(mjParse('sin(u) * 2'), ['u']);
    const s: Record<string, unknown> = { u: 0 };
    for (const u of [0, 1, 2]) {
      s.u = u;
      expect(ev.evaluate(s)).toBe(Math.sin(u) * 2);
    }
    // …and without the hint the value-keyed memo is still correct.
    const ev2 = fastCompile(mjParse('sin(u) * 2'));
    for (const u of [0, 1, 2, 1]) {
      s.u = u;
      expect(ev2.evaluate(s)).toBe(Math.sin(u) * 2);
    }
  });

  it('shares repeated per-sample sub-expressions (CSE)', () => {
    let calls = 0;
    const w = (v: number) => (calls++, Math.sin(v));
    const ev = fastCompile(mjParse('w(3t + 1) * cos(t) + w(3t + 1)'));
    const s: Record<string, unknown> = { w, t: 0 };
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      s.t = t;
      expect(ev.evaluate(s)).toBeCloseTo(Math.sin(3 * t + 1) * Math.cos(t) + Math.sin(3 * t + 1), 12);
    }
    expect(calls).toBe(10);
  });

  it('does not memoise impure functions or throwing evaluations', () => {
    const ev = fastCompile(mjParse('random() + a'));
    const vals = new Set<unknown>();
    for (let i = 0; i < 5; i++) vals.add(ev.evaluate({ a: 1 }));
    expect(vals.size).toBeGreaterThan(1);
    const ev2 = fastCompile(mjParse('sqrt(bq) + t'));
    expect(() => ev2.evaluate({ t: 1 })).toThrow(/Undefined symbol bq/);
    expect(ev2.evaluate({ t: 1, bq: 4 })).toBe(3);
  });

  it('falls back to mathjs for unsafe names', () => {
    const ev = fastCompile(mjParse('constructor + 1'));
    expect(() => ev.evaluate({})).toThrow();
  });
});
