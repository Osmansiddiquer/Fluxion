import { describe, expect, it } from 'vitest';
import { advance, fineStep, sliderBounds, stepValue } from './anim';
import { autoplayIds, stepPlaying } from '../state/animate';
import { usePlayer } from '../state/player';
import type { Entry } from '../store/types';

const E = (id: string, raw: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  raw,
  color: '#000',
  visible: true,
  expanded: false,
  ...extra,
});

describe('advance', () => {
  it('moves at a full sweep per ~4s at 1×', () => {
    const r = advance(0, 1, 0, 4, 'loop', 1, 1);
    expect(r.value).toBeCloseTo(1);
    expect(advance(0, 1, 0, 4, 'loop', 2, 1).value).toBeCloseTo(2);
  });
  it('loop wraps the overshoot (seamless rotation)', () => {
    const r = advance(3.5, 1, 0, 4, 'loop', 1, 1);
    expect(r.value).toBeCloseTo(0.5);
    expect(r.finished).toBe(false);
    expect(advance(0.5, -1, 0, 4, 'loop', 1, 1).value).toBeCloseTo(3.5);
  });
  it('bounce reverses at the ends', () => {
    const r = advance(3.5, 1, 0, 4, 'bounce', 1, 1);
    expect(r.value).toBe(4);
    expect(r.dir).toBe(-1);
    expect(advance(0.2, -1, 0, 4, 'bounce', 1, 1).dir).toBe(1);
  });
  it('once stops at the end', () => {
    const r = advance(3.5, 1, 0, 4, 'once', 1, 1);
    expect(r.value).toBe(4);
    expect(r.finished).toBe(true);
  });
  it('clamps a tiny speed', () => {
    expect(advance(0, 1, 0, 4, 'loop', 0, 1).value).toBeCloseTo(0.05);
  });
});

describe('slider helpers', () => {
  it('fineStep is a power of ten ~1/1000 of the span', () => {
    expect(fineStep(20)).toBeCloseTo(0.1);
    expect(fineStep(2)).toBeCloseTo(0.01);
    expect(fineStep(0)).toBe(0.01);
  });
  it('sliderBounds defaults to ±10 around the value', () => {
    expect(sliderBounds(E('a', 'a = 3'), 3)).toMatchObject({ value: 3, min: -10, max: 10 });
    expect(sliderBounds(E('a', 'a = 30'), 30).max).toBe(30);
    expect(sliderBounds(E('a', 'a = 1', { varMin: 0, varMax: 2, varStep: 0.5, varValue: 1.5 }), 1)).toEqual({
      value: 1.5,
      min: 0,
      max: 2,
      step: 0.5,
    });
  });
  it('stepValue snaps to the step grid and clamps', () => {
    expect(stepValue(0, 0, 1, 0.1, 1)).toBeCloseTo(0.1);
    expect(stepValue(0.13, 0, 1, 0.1, 1)).toBeCloseTo(0.2);
    expect(stepValue(0.13, 0, 1, 0.1, -1)).toBeCloseTo(0);
    expect(stepValue(1, 0, 1, 0.1, 1)).toBe(1);
    expect(stepValue(0, 0, 1, 0.1, -1)).toBe(0);
    // one frame at 30 fps
    expect(stepValue(2, 0, 10, 1 / 30, 1)).toBeCloseTo(2 + 1 / 30);
  });
});

describe('stepPlaying (shared animation clock)', () => {
  it('advances every playing variable in one pass', () => {
    const entries = [
      E('a', 'a = 0', { varMin: 0, varMax: 4 }),
      E('b', 'b = 0', { varMin: 0, varMax: 8, animSpeed: 2 }),
      E('c', 'c = 0'),
    ];
    const { values, stopped } = stepPlaying(entries, { a: 1, b: 1 }, 1);
    expect(values.get('a')).toBeCloseTo(1);
    expect(values.get('b')).toBeCloseTo(4);
    expect(values.has('c')).toBe(false);
    expect(stopped).toEqual([]);
  });
  it('reports direction flips, finished and vanished/non-variable entries', () => {
    const entries = [
      E('a', 'a = 0', { varMin: 0, varMax: 4, varValue: 3.9, animMode: 'bounce' }),
      E('b', 'b = 0', { varMin: 0, varMax: 4, varValue: 3.9, animMode: 'once' }),
      E('c', 'y = sin(t)'),
    ];
    const r = stepPlaying(entries, { a: 1, b: 1, c: 1, gone: 1 }, 1);
    expect(r.dirs.get('a')).toBe(-1);
    expect(r.stopped.sort()).toEqual(['b', 'c', 'gone']);
  });
  it('autoplayIds picks flagged variables once', () => {
    const entries = [E('a', 'a = 0', { autoplay: true }), E('b', 'y = t', { autoplay: true }), E('c', 'c = 1')];
    const started = new Set<string>();
    expect(autoplayIds(entries, started)).toEqual(['a']);
    started.add('a');
    expect(autoplayIds(entries, started)).toEqual([]);
  });
});

describe('player store', () => {
  it('play / pause / toggle / setDir', () => {
    const p = usePlayer.getState();
    p.stopAll();
    p.play('x');
    expect(usePlayer.getState().playing).toEqual({ x: 1 });
    p.setDir('x', -1);
    expect(usePlayer.getState().playing.x).toBe(-1);
    p.toggle('x');
    expect(usePlayer.getState().playing).toEqual({});
    p.toggle('y');
    p.pause('y');
    p.pause('nope');
    expect(usePlayer.getState().playing).toEqual({});
  });
});
