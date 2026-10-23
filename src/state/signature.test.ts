import { describe, expect, it } from 'vitest';
import { computeSignature } from './signature';
import type { Entry } from '../store/types';

const base: Entry = { id: 'a', raw: '(cos(t), sin(t))', color: '#000000', visible: true, expanded: false };
const sig = (patch: Partial<Entry>) => computeSignature([{ ...base, ...patch }]);

describe('computeSignature', () => {
  it.each<[string, Partial<Entry>]>([
    ['raw', { raw: '(t, t)' }],
    ['visibility', { visible: false }],
    ['slider value', { varValue: 2 }],
    ['parametric / polar range', { thetaMax: 1 }],
    ['range start', { thetaMin: -1 }],
    ['frames asset', { frames: 'fx123' }],
    ['IVP', { t0: 1, ic: [2] }],
  ])('changes with %s', (_label, patch) => {
    expect(sig(patch)).not.toBe(sig({}));
  });

  it.each<[string, Partial<Entry>]>([
    ['colour', { color: '#ff0000' }],
    ['colour expression', { colorExpr: 'hsv(a,1,1)' }],
    ['fill', { fill: true, fillOpacity: 0.8, fillColor: '#fff' }],
    ['line style', { lineWidth: 5, lineStyle: 'dashed' }],
    ['autoplay / animation', { autoplay: true, animSpeed: 3, animMode: 'bounce' }],
    ['slider bounds', { varMin: 0, varMax: 3, varStep: 0.5 }],
    ['expanded', { expanded: true }],
  ])('ignores %s', (_label, patch) => {
    expect(sig(patch)).toBe(sig({}));
  });

  it('fields cannot run together', () => {
    expect(computeSignature([{ ...base, raw: 'a1', visible: true }])).not.toBe(
      computeSignature([{ ...base, raw: 'a', visible: true, id: 'a1' }]),
    );
  });
});
