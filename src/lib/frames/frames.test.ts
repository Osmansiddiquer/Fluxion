import { beforeEach, describe, expect, it } from 'vitest';
import {
  FrameSequence,
  decodeFrame,
  encodeClip,
  encodeFrame,
  fromBase64Url,
  parseHeader,
  toBase64Url,
  type IPoly,
} from './codec';
import {
  insideEvenOdd,
  polygonArea,
  simplifyClosed,
  simplifyOpen,
  threshold,
  traceContours,
  vectorize,
  type BinaryImage,
} from './trace';
import { _resetAssets, assetsFor, getAsset, getFrameSequence, hashString, putAsset, registerAssets } from './assets';

function img(rows: string[]): BinaryImage {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);
  rows.forEach((r, j) => [...r].forEach((c, i) => (data[j * width + i] = c === '#' ? 1 : 0)));
  return { width, height, data };
}

/** Rasterise polygons back (even-odd at pixel centres, half-pixel units). */
function raster(polys: IPoly[], w: number, h: number): string[] {
  const rows: string[] = [];
  for (let j = 0; j < h; j++) {
    let s = '';
    for (let i = 0; i < w; i++) s += insideEvenOdd(polys, 2 * i + 1, 2 * j + 1) ? '#' : '.';
    rows.push(s);
  }
  return rows;
}

describe('base64url + varint codec', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 31, 256]) {
      const bytes = Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect([...fromBase64Url(toBase64Url(bytes))]).toEqual(bytes);
    }
  });
  it('rejects invalid characters', () => {
    expect(() => fromBase64Url('ab$c')).toThrow();
  });
  it('round-trips frames with negative deltas and large coordinates', () => {
    const polys: IPoly[] = [
      [
        [0, 0],
        [300, 2],
        [5, 70000],
      ],
      [
        [9, 9],
        [8, 8],
        [10, 7],
        [9, 9],
      ],
    ];
    expect(decodeFrame(encodeFrame(polys))).toEqual(polys);
  });
  it('drops degenerate polygons and handles empty frames', () => {
    expect(decodeFrame(encodeFrame([[[1, 1]]]))).toEqual([]);
    expect(decodeFrame(encodeFrame([]))).toEqual([]);
    expect(decodeFrame('')).toEqual([]);
  });
  it('detects truncated data', () => {
    const s = encodeFrame([
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    ]);
    expect(() => decodeFrame(s.slice(0, 3))).toThrow();
  });
});

describe('clips', () => {
  const clip = {
    w: 20,
    h: 10,
    fps: 24,
    box: [-2, -1, 2, 1] as [number, number, number, number],
    frames: [
      [
        [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10],
        ],
      ],
      [],
      [
        [
          [10, 5],
          [12, 5],
          [12, 7],
        ],
      ],
    ] as IPoly[][],
  };
  it('header round-trips', () => {
    const h = parseHeader(encodeClip(clip));
    expect(h).toEqual({ w: 20, h: 10, fps: 24, box: [-2, -1, 2, 1] });
  });
  it('rejects bad headers', () => {
    expect(() => parseHeader('nope')).toThrow();
    expect(() => parseHeader('FXF1;w=0;h=2;box=0,0,1,1')).toThrow();
    expect(() => parseHeader('FXF1;w=2;h=2;box=0,0,1')).toThrow();
  });
  it('FrameSequence decodes lazily, wraps indices, maps to data space', () => {
    const seq = new FrameSequence(encodeClip(clip));
    expect(seq.count).toBe(3);
    expect(seq.frame(0)).toEqual(clip.frames[0]);
    expect(seq.frame(3)).toEqual(clip.frames[0]);
    expect(seq.frame(-1)).toEqual(clip.frames[2]);
    expect(seq.frame(1.9)).toEqual([]);
    expect(seq.frame(NaN)).toEqual([]);
    const d = seq.frameInData(0)[0];
    expect(d[0]).toEqual([-2, 1]); // top-left of the image → top-left of the box
    expect(d[2]).toEqual([2, -1]);
    expect(d[d.length - 1]).toEqual(d[0]); // closed
  });
});

describe('contour tracing', () => {
  it('a single pixel becomes one small diamond around its centre', () => {
    const loops = traceContours(img(['...', '.#.', '...']));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(raster(loops, 3, 3)).toEqual(['...', '.#.', '...']);
  });
  it('reproduces shapes with holes under even-odd fill', () => {
    const rows = ['.......', '.#####.', '.#...#.', '.#.#.#.', '.#...#.', '.#####.', '.......'];
    const loops = traceContours(img(rows));
    expect(loops).toHaveLength(3); // outer, hole, island
    expect(raster(loops, 7, 7)).toEqual(rows);
  });
  it('closes contours that touch the image border', () => {
    const rows = ['###', '###'];
    const loops = traceContours(img(rows));
    expect(loops).toHaveLength(1);
    expect(raster(loops, 3, 2)).toEqual(rows);
  });
  it('keeps diagonal (saddle) neighbours as separate blobs', () => {
    const rows = ['#.', '.#'];
    expect(traceContours(img(rows))).toHaveLength(2);
    expect(raster(traceContours(img(rows)), 2, 2)).toEqual(rows);
  });
  it('blank and full images', () => {
    expect(traceContours(img(['....', '....']))).toEqual([]);
    expect(raster(traceContours(img(['##', '##'])), 2, 2)).toEqual(['##', '##']);
  });
  it('thresholds grayscale', () => {
    const b = threshold([0, 200, 100, 255], 2, 2);
    expect([...b.data]).toEqual([1, 0, 1, 0]);
    expect([...threshold([0, 200], 2, 1, 128, false).data]).toEqual([0, 1]);
  });
});

describe('simplification', () => {
  it('collinear points collapse; corners stay', () => {
    const line: IPoly = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(simplifyOpen(line, 0.5)).toEqual([
      [0, 0],
      [3, 0],
    ]);
    const sq: IPoly = [];
    for (let i = 0; i < 10; i++) sq.push([i, 0]);
    for (let i = 0; i < 10; i++) sq.push([10, i]);
    for (let i = 10; i > 0; i--) sq.push([i, 10]);
    for (let i = 10; i > 0; i--) sq.push([0, i]);
    const s = simplifyClosed(sq, 0.5);
    expect(s).toHaveLength(4);
    expect(Math.abs(polygonArea(s))).toBeCloseTo(100);
  });
  it('vectorize a disc: far fewer points, area preserved', () => {
    const W = 40;
    const data = new Uint8Array(W * W);
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) data[j * W + i] = Math.hypot(i - 19.5, j - 19.5) < 15 ? 1 : 0;
    const raw = traceContours({ width: W, height: W, data });
    const v = vectorize({ width: W, height: W, data }, 1);
    expect(v).toHaveLength(1);
    expect(v[0].length).toBeLessThan(raw[0].length / 2);
    const areaPx = Math.abs(polygonArea(v[0])) / 4; // half-pixel units²
    expect(areaPx).toBeGreaterThan(Math.PI * 15 * 15 * 0.93);
    expect(areaPx).toBeLessThan(Math.PI * 15 * 15 * 1.07);
  });
  it('drops specks below minArea', () => {
    expect(vectorize(img(['...', '.#.', '...']), 1, 10)).toEqual([]);
  });
});

describe('asset store', () => {
  beforeEach(() => _resetAssets());
  it('content-addresses payloads', () => {
    const a = putAsset('hello');
    expect(putAsset('hello')).toBe(a);
    expect(putAsset('world')).not.toBe(a);
    expect(getAsset(a)).toBe('hello');
    expect(getAsset(undefined)).toBeUndefined();
    expect(hashString('a')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('exports and re-imports by id', () => {
    const id = putAsset('payload');
    const exported = assetsFor([id, undefined, 'missing']);
    expect(exported).toEqual({ [id]: 'payload' });
    _resetAssets();
    expect(getAsset(id)).toBeUndefined();
    registerAssets(exported);
    expect(getAsset(id)).toBe('payload');
  });
  it('getFrameSequence decodes once and reports problems', () => {
    const id = putAsset(encodeClip({ w: 1, h: 1, fps: 1, box: [0, 0, 1, 1], frames: [[], []] }));
    const s = getFrameSequence(id);
    expect(s).toBeInstanceOf(FrameSequence);
    expect(getFrameSequence(id)).toBe(s);
    expect(getFrameSequence(putAsset('garbage'))).toBeInstanceOf(Error);
    expect(getFrameSequence(undefined)).toBeInstanceOf(Error);
  });
});
