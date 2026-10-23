import { describe, expect, it } from 'vitest';
import { parseEntry } from '../math/parse';
import { computeAll } from '../compute';
import type { Entry } from '../../store/types';

// Links are untrusted input: expressions may only ever *evaluate* known functions.
// (mathjs exposes helpers like createUnit/evaluate/simplify in its expression
// language; they must never run from a shared link.)
const entry = (raw: string, id = raw): Entry => ({ id, raw, color: '#000000', visible: true, expanded: false });
const VP = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };

describe('parser / compute hardening', () => {
  it('does not evaluate an unknown function to make a slider', () => {
    const p = parseEntry('k = createUnit("zzapi")');
    expect(p.kind).not.toBe('variable');
    const r = computeAll([entry('k = createUnit("zzapi")')], VP).get('k = createUnit("zzapi")')!;
    expect(r.unknownFns).toEqual(['createUnit']);
  });
  it('still evaluates known-function constants as sliders', () => {
    expect(parseEntry('k = sqrt(2)')).toMatchObject({ kind: 'variable', value: Math.SQRT2 });
  });
  it('does not evaluate unknown functions inside a point variable', () => {
    const res = computeAll([entry('A = (evaluate("1"), 2)', 'a'), entry('(A, (0,0))', 'b')], VP);
    expect(res.get('a')!.unknownFns).toEqual(['evaluate']);
    expect(res.get('a')!.points).toBeUndefined();
  });
  it('accepts ≤ and ≥ as inequality operators', () => {
    expect(parseEntry('y ≤ x')).toMatchObject({ kind: 'inequality' });
    expect(parseEntry('x^2 + y^2 ≥ 1')).toMatchObject({ kind: 'inequality' });
  });
  it('accepts Unicode primes (common in LLM output)', () => {
    expect(parseEntry('y′ = -y')).toMatchObject({ kind: 'ode', depVar: 'y', order: 1 });
    expect(parseEntry('y″ = -y')).toMatchObject({ kind: 'ode', depVar: 'y', order: 2 });
    expect(parseEntry('y′′ + y = 0')).toMatchObject({ kind: 'ode', order: 2 });
  });
});
