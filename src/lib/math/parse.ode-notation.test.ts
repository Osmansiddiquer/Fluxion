import { describe, expect, it } from 'vitest';
import { parseEntry, type Parsed } from './parse';
import { entryToLatex } from './tolatex';
import { latexToText } from './fromlatex';
import { usesLeibnizX } from './normalize';

type Ode = Extract<Parsed, { kind: 'ode' }>;
const ode = (raw: string) => {
  const p = parseEntry(raw);
  expect(p.kind, raw).toBe('ode');
  return p as Ode;
};

describe('dy/dx notation', () => {
  it('reads x as the independent variable (rewritten to t)', () => {
    for (const raw of ['dy/dx = x + y', '((dy)/(dx))=x+y', 'd^2y/dx^2 = -x*y', 'd²y/dx² = -x*y']) {
      const p = ode(raw);
      expect(p.indep).toBe('x');
      expect(p.deps).toEqual([]);
      expect(p.node.toString()).not.toMatch(/\bx\b/);
    }
    expect(ode('d^2y/dx^2 = -y').order).toBe(2);
  });
  it('rejects mixing t into a dy/dx equation, and solving for x', () => {
    expect(parseEntry('dy/dx = t').kind).toBe('error');
    expect(parseEntry('dx/dx = 1').kind).toBe('error');
  });
  it('detects Leibniz-x only as a derivative token', () => {
    expect(usesLeibnizX('dy/dx = 1')).toBe(true);
    expect(usesLeibnizX('dy/dt = x')).toBe(false);
    expect(usesLeibnizX('y = and/dx')).toBe(false);
  });
  it("prime notation in x carries an x-reading for compute to choose", () => {
    const p = ode("y' = x*y");
    expect(p.deps).toEqual(['x']);
    expect(p.xAlt?.indep).toBe('x');
    expect(p.xAlt?.deps).toEqual([]);
  });
  it('systems keep x as a dependent variable', () => {
    const p = ode("x' = -y");
    expect(p.depVar).toBe('x');
    expect(p.xAlt).toBeUndefined();
    // A row that differentiates x is never read in x.
    expect(ode("y'' = x' + x").xAlt).toBeUndefined();
    // t present: t is the variable, x a slider.
    expect(ode("y' = x*t").xAlt).toBeUndefined();
  });
});

describe('typed conditions', () => {
  it('own rows: one variable, any number of conditions', () => {
    const p = parseEntry("y'(pi) = -a");
    expect(p.kind).toBe('condition');
    if (p.kind !== 'condition') return;
    expect(p.conds[0].k).toBe(1);
    expect(p.deps).toEqual(['a']);
    expect(parseEntry('y(0) = 0, y(pi) = 0').kind).toBe('condition');
    expect(parseEntry('x(0) = 1, y(0) = 2').kind).toBe('error');
  });
  it('after commas on the ODE row', () => {
    const p = ode("y'' = -y, y(0) = 1, y'(0) = 0");
    expect(p.conds?.map((c) => [c.k, c.at.toString(), c.value.toString()])).toEqual([
      [0, '0', '1'],
      [1, '0', '0'],
    ]);
    expect(parseEntry("y' = -y, x(0) = 1").kind).toBe('error');
  });
  it('is not confused with functions, calls or systems on one row', () => {
    expect(parseEntry('f(a) = 2').kind).toBe('fndef');
    expect(parseEntry('u(s) = s^2').kind).toBe('fndef');
    expect(parseEntry('H(s) = 2s').kind).toBe('fndef');
    expect(parseEntry('sin(0) = y').kind).not.toBe('condition');
    expect(parseEntry('y(t) = 2').kind).not.toBe('condition');
    expect(parseEntry('y(x) = x^2').kind).not.toBe('condition');
    // Two equations on a row are still not a system.
    expect(parseEntry("x' = -y, y' = x").kind).toBe('error');
    // Commas inside calls don't split.
    expect(ode("y' = max(y, 1)").conds).toBeUndefined();
  });
  it('conditions for a system variable x', () => {
    const p = parseEntry('x(0) = 1');
    expect(p.kind).toBe('condition');
    if (p.kind === 'condition') expect(p.depVar).toBe('x');
  });
});

describe('step and impulse forcing', () => {
  it('extracts delta terms as impulses (coefficient, slope) and zeroes them', () => {
    const p = ode("m y'' + k y = J delta(2(t - T))");
    expect(p.impulses).toHaveLength(1);
    expect(p.node.toString()).not.toMatch(/delta|__imp/);
    expect(p.deps.sort()).toEqual(['J', 'T', 'k', 'm']);
  });
  it('rejects deltas it cannot apply', () => {
    for (const raw of ["y' = delta(y)", "y' = delta(t^2 - 1)", "y' = delta(t)^2", "y' = delta(t)*delta(t - 1)"]) {
      expect(parseEntry(raw).kind, raw).toBe('error');
    }
  });
  it('records step-function breakpoints', () => {
    expect(ode("y' = -y + H(t - 1) - u(t - 3) + heaviside(2t)").breaks).toHaveLength(3);
    expect(ode("y' = H(y)").breaks).toBeUndefined();
  });
});

describe('LaTeX round trip', () => {
  for (const raw of [
    "y'' = -y, y(0) = 1, y'(0) = 0",
    'y(0) = 0, y(pi) = 0',
    "y'(1) = 2",
    'dy/dx = x + y',
    'd^2y/dx^2 = -y',
    "y'' + y = delta(t - 1)",
    "y' = -y + H(t - 1)",
  ]) {
    it(raw, () => {
      const p = parseEntry(raw);
      const tex = entryToLatex(p);
      expect(tex).toBeTruthy();
      const back = parseEntry(latexToText(tex!));
      expect(back.kind).toBe(p.kind);
      if (p.kind === 'ode' && back.kind === 'ode') {
        expect(back.node.toString()).toBe(p.node.toString());
        expect(back.indep).toBe(p.indep);
        expect(back.conds?.length).toBe(p.conds?.length);
        expect(back.impulses?.length).toBe(p.impulses?.length);
      }
    });
  }
  it('renders dy/dx as a fraction and delta as δ', () => {
    expect(entryToLatex(parseEntry('dy/dx = x'))).toMatch(/^\\frac\{dy\}\{dx\}/);
    expect(entryToLatex(parseEntry("y'' = delta(t)"))).toContain('\\delta\\left(');
  });
});

describe("a prime after a bracket (mathjs would read it as a transpose)", () => {
  it.each(["X'' = -X - b*(X - x_0)'", "y' = (y)'", "y = sin(x)'"])('%s is an error, not a silently dropped derivative', (raw) => {
    const p = parseEntry(raw);
    expect(p.kind).toBe('error');
    if (p.kind === 'error') expect(p.message).toMatch(/prime/);
  });
  it('primes on names still work', () => {
    expect(parseEntry("X'' = -X - b*X'").kind).toBe('ode');
    expect(parseEntry("y'(0) = 1").kind).toBe('condition');
  });
});
