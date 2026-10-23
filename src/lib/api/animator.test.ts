import { describe, expect, it } from 'vitest';
import { LIMITS, validateSpec } from './spec';
import { sanitizeGraph } from './load';
import type { GraphData } from '../graphFile';

const errs = (spec: unknown) => {
  const v = validateSpec(spec);
  return v.ok ? '' : v.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
};

describe('raised limits (animator scenes)', () => {
  it('are 300 expressions, 3000 chars per expression, 600 per colour expression', () => {
    expect(LIMITS.maxExpressions).toBe(300);
    expect(LIMITS.maxExprLength).toBe(3000);
    expect(LIMITS.maxColorExprLength).toBe(600);
  });

  it('accept a scene at the limits and reject one past them', () => {
    expect(errs({ expressions: new Array(300).fill('y = x') })).toBe('');
    expect(errs({ expressions: new Array(301).fill('y = x') })).toMatch(/too many expressions/);
    const long = `y = ${'1 + '.repeat(745)}x`; // 2988 chars
    expect(long.length).toBeLessThanOrEqual(3000);
    expect(errs({ expressions: [long] })).toBe('');
    expect(errs({ expressions: [`${long}${' + 1'.repeat(10)}`] })).toMatch(/too long/);
    const col = `rgb(${'1+'.repeat(195)}1, 0, 0)`;
    expect(col.length).toBeLessThanOrEqual(600);
    expect(errs({ expressions: [{ expr: 'y = x', colorExpr: col }] })).toBe('');
    expect(errs({ expressions: [{ expr: 'y = x', colorExpr: `rgb(${'1+'.repeat(300)}1, 0, 0)` }] })).toMatch(/too long/);
  });

  it('sanitizeGraph keeps 300 entries and 3000-char expressions', () => {
    const raw = `y = ${'1 + '.repeat(745)}x`;
    const g = {
      v: 1,
      entries: Array.from({ length: 320 }, (_, i) => ({ id: `e${i}`, raw, color: '#000000', visible: true, expanded: false })),
      viewport: { tMin: -1, tMax: 1, yMin: -1, yMax: 1 },
    } as unknown as GraphData;
    const out = sanitizeGraph(g);
    expect(out.entries).toHaveLength(300);
    expect(out.entries[0].raw).toBe(raw);
  });
});
