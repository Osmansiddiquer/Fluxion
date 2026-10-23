import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS, buildClip, cleanClipName, frameTimes, grayFromRGBA, inkMask, scaledSize, traceGray, DEFAULT_TRACE } from './videoImport';
import { FrameSequence } from './codec';
import { insideEvenOdd } from './trace';
import { clipScriptGraph } from './clipScript';
import { runHeadless } from '../script/testkit';

/** RGBA image of a dark disc on white. */
function disc(w: number, h: number, cx: number, cy: number, r: number, alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;
      px[i] = px[i + 1] = px[i + 2] = ink ? 20 : 240;
      px[i + 3] = alpha;
    }
  return px;
}

describe('in-app clip import pipeline', () => {
  it('gray: luma, transparent counts as paper', () => {
    expect([...grayFromRGBA([255, 0, 0, 255, 0, 0, 0, 0], 2, 1)]).toEqual([76, 255]);
  });
  it('threshold / invert for the preview', () => {
    const g = grayFromRGBA(disc(8, 8, 4, 4, 2), 8, 8);
    const ink = inkMask(g, 8, 8, { threshold: 128, invert: false });
    expect(ink[4 * 8 + 4]).toBe(1);
    expect(ink[0]).toBe(0);
    expect(inkMask(g, 8, 8, { threshold: 128, invert: true })[0]).toBe(1);
  });
  it('sizes: even, clamped, aspect kept', () => {
    expect(scaledSize(1920, 1080, 160)).toEqual({ w: 160, h: 90 });
    expect(scaledSize(1920, 1080, 9999).w).toBe(IMPORT_LIMITS.maxWidth);
    expect(scaledSize(100, 100, 1).w).toBe(IMPORT_LIMITS.minWidth);
  });
  it('frame times: centred samples, capped duration and count', () => {
    expect(frameTimes(1, 4)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(frameTimes(10, 2, 2, 3)).toEqual([2.25, 2.75]);
    expect(frameTimes(600, 30).length).toBe(IMPORT_LIMITS.maxSeconds * 30);
    expect(frameTimes(600, 1000).length).toBeLessThanOrEqual(IMPORT_LIMITS.maxFrames);
    expect(frameTimes(0.01, 10)).toHaveLength(1);
  });
  it('names', () => {
    expect(cleanClipName('Bad Apple!! (PV).mp4')).toBe('bad-apple-pv');
    expect(cleanClipName('apple.gif', ['apple'])).toBe('apple-2');
    expect(cleanClipName('???')).toBe('clip');
  });
  it('traces moving frames into a clip a script can play', () => {
    const W = 40;
    const H = 30;
    const frames = [0, 1, 2].map((f) => traceGray(grayFromRGBA(disc(W, H, 10 + 10 * f, 15, 6), W, H), W, H, DEFAULT_TRACE));
    const data = buildClip(frames, W, H, 12);
    const seq = new FrameSequence(data);
    expect(seq.count).toBe(3);
    expect(seq.header.fps).toBe(12);
    expect(seq.header.box).toEqual([-4, -3, 4, 3]);
    // Frame 2's disc is at pixel x = 30 of 40 → data x = 2.
    const polys = seq.frame(2);
    expect(insideEvenOdd(polys, 2 * 30, 2 * 15)).toBe(true);
    expect(insideEvenOdd(polys, 2 * 10, 2 * 15)).toBe(false);
    // …and the generated player graph runs it.
    const g = clipScriptGraph(data, 'ball');
    const clip = { name: 'ball', id: Object.keys(g.assets!)[0], frames: 3, fps: 12, box: seq.header.box };
    const r = runHeadless(g.script!.code, { clips: [clip], time: 0.1 });
    expect(r.error).toBeUndefined();
    expect(r.frame.items.find((i) => i.k === 'clip')).toMatchObject({ frame: 1 });
    expect(r.frame.loop).toBeCloseTo(0.25);
  });
});
