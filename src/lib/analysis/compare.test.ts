import { describe, expect, it } from 'vitest';
import { exactSliceValues, formatDiff, MAX_DIFFS, sliceDifferences } from './compare';
import { computeAll } from '../compute';
import { verticalCrossings } from './eval';
import type { Entry } from '../../store/types';

describe('numerical vs analytic difference at the slice', () => {
  it('pairs each ODE with the closest agreeing function', () => {
    const d = sliceDifferences([
      { id: 'o', kind: 'ode', values: [0.135335] },
      { id: 'f', kind: 'function', values: [0.135335283] },
      { id: 'g', kind: 'function', values: [0.9] },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].odeId).toBe('o');
    expect(d[0].fnId).toBe('f');
    expect(d[0].diff).toBeCloseTo(0.135335 - 0.135335283, 15);
  });

  it('stays quiet for unrelated curves, multi-valued cuts or no function', () => {
    expect(sliceDifferences([{ id: 'o', kind: 'ode', values: [2] }, { id: 'f', kind: 'function', values: [3] }])).toEqual([]);
    expect(sliceDifferences([{ id: 'o', kind: 'ode', values: [1] }])).toEqual([]);
    expect(sliceDifferences([{ id: 'o', kind: 'ode', values: [1, 2] }, { id: 'f', kind: 'function', values: [1] }])).toEqual([]);
    expect(sliceDifferences([{ id: 'o', kind: 'ode', values: [1] }, { id: 'f', kind: 'function', values: [] }])).toEqual([]);
  });

  it('caps the readout', () => {
    const items = [
      { id: 'f', kind: 'function' as const, values: [1] },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, kind: 'ode' as const, values: [1 + i * 1e-4] })),
    ];
    expect(sliceDifferences(items)).toHaveLength(MAX_DIFFS);
  });

  it('formats differences readably', () => {
    expect(formatDiff(0)).toBe('0');
    expect(formatDiff(1e-15)).toBe('< 10⁻¹²');
    expect(formatDiff(2.4e-7)).toBe('2.4×10⁻⁷');
    expect(formatDiff(-3.14159e-5, 3)).toBe('-3.14×10⁻⁵');
    expect(formatDiff(0.0123)).toBe('0.012');
  });

  it('reads a real ODE against its exact solution (y′ = −y vs e^(−x))', () => {
    const o: Entry = { id: 'o', raw: "y' = -y", color: '#c74440', visible: true, expanded: false, ic: [1] };
    const f: Entry = { id: 'f', raw: 'y = e^(-x)', color: '#2d70b3', visible: true, expanded: false };
    const res = computeAll([o, f], { tMin: -1, tMax: 5, yMin: -1, yMax: 2 }, 300);
    const ro = res.get('o')!;
    const rf = res.get('f')!;
    // The drawn polylines differ by their linear read-off error,
    const lin = verticalCrossings(ro.curve, 2.01)[0] - verticalCrossings(rf.curve, 2.01)[0];
    // the exact values by the solver's error (RK4, h = 0.02: about 1e-9).
    const vo = exactSliceValues(ro, 2.01, {});
    const vf = exactSliceValues(rf, 2.01, {});
    expect(vf[0]).toBeCloseTo(Math.exp(-2.01), 14);
    const d = sliceDifferences([
      { id: 'o', kind: 'ode', values: vo },
      { id: 'f', kind: 'function', values: vf },
    ]);
    expect(d).toHaveLength(1);
    expect(Math.abs(d[0].diff)).toBeLessThan(1e-8);
    expect(Math.abs(d[0].diff)).toBeLessThan(Math.abs(lin));
    // Outside the integrated span: no value.
    expect(ro.ode!.valueAt!(50)).toBeNull();
  });
});
