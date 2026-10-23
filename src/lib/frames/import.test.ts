import { describe, expect, it } from 'vitest';
import { parseNetpbm } from './netpbm';
import { clipGraph } from './clipGraph';
import { encodeClip } from './codec';
import { registerAssets, _resetAssets } from './assets';
import { computeAll } from '../compute';
import { isGraph } from '../graphFile';

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (a: Uint8Array, b: number[]) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

describe('parseNetpbm', () => {
  it('reads binary PGM (P5) with comments', () => {
    const img = parseNetpbm(concat(enc('P5\n# made by ffmpeg\n3 2\n255\n'), [0, 128, 255, 10, 20, 30]));
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect([...img.data]).toEqual([0, 128, 255, 10, 20, 30]);
  });
  it('rescales a non-255 maxval and 16-bit samples', () => {
    expect([...parseNetpbm(concat(enc('P5 2 1 15 '), [0, 15])).data]).toEqual([0, 255]);
    expect([...parseNetpbm(concat(enc('P5 1 1 65535 '), [0xff, 0xff])).data]).toEqual([255]);
  });
  it('reads plain PGM (P2)', () => {
    expect([...parseNetpbm(enc('P2\n2 2\n4\n0 1\n2 4\n')).data]).toEqual([0, 64, 128, 255]);
  });
  it('reads PBM, where 1 means black (P1 and packed P4)', () => {
    expect([...parseNetpbm(enc('P1\n3 1\n1 0 1\n')).data]).toEqual([0, 255, 0]);
    expect([...parseNetpbm(enc('P1\n3 1\n101')).data]).toEqual([0, 255, 0]);
    // 10 px wide → 2 bytes per row: 1000000001 → 0x80 0x40
    expect([...parseNetpbm(concat(enc('P4\n10 1\n'), [0x80, 0x40])).data]).toEqual([
      0, 255, 255, 255, 255, 255, 255, 255, 255, 0,
    ]);
  });
  it('rejects unsupported or truncated files', () => {
    expect(() => parseNetpbm(enc('P6\n1 1\n255\n'))).toThrow(/Unsupported/);
    expect(() => parseNetpbm(concat(enc('P5\n4 4\n255\n'), [1, 2]))).toThrow(/Truncated/);
    expect(() => parseNetpbm(enc('P5\n'))).toThrow();
  });
});

describe('clipGraph', () => {
  const data = encodeClip({
    w: 16,
    h: 12,
    fps: 30,
    box: [-4, -3, 4, 3],
    frames: Array.from({ length: 60 }, (_, f) => [
      [
        [f % 16, 0],
        [16, 0],
        [16, 12],
      ] as [number, number][],
    ]),
  });
  it('builds a valid, self-contained graph that plays in real time', () => {
    const g = clipGraph(data, { idPrefix: 'x' });
    expect(isGraph(g)).toBe(true);
    const clock = g.entries[0];
    expect(clock.varMax).toBe(2); // 60 frames at 30 fps
    expect(clock.varStep).toBeCloseTo(1 / 30);
    expect(clock.animSpeed).toBeCloseTo(2); // 4 s sweep scaled to 2 s
    expect(g.entries[2].raw).toBe('frames(30 T)');
    expect(Object.keys(g.assets!)).toEqual([g.entries[2].frames]);
  });
  it('computes frame-by-frame once its asset is registered', () => {
    _resetAssets();
    const g = clipGraph(data, { idPrefix: 'y' });
    registerAssets(g.assets);
    const at = (T: number) =>
      computeAll(g.entries.map((e, i) => (i === 0 ? { ...e, varValue: T } : e)), g.viewport, 200).get(
        g.entries[2].id,
      )!;
    const a = at(0);
    const b = at(5 / 30);
    expect(a.error).toBeUndefined();
    expect(a.curve.segments[0][0]).not.toEqual(b.curve.segments[0][0]);
  });
});
