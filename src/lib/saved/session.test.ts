import { describe, expect, it } from 'vitest';
import { applyRemote, docStatus, fileNameFor, matchesQuery, relativeTime, type DocLink } from './session';
import { makeThumbnail, thumbnailOfPlot, THUMB_H, THUMB_W } from './thumbnail';
import { openLibraryChannel, type LibraryMessage } from './channel';
import { copyPendingText } from './clipboard';
import { GraphLibrary } from './library';
import { memoryKV } from './kv';
import { buildShareLink } from '../api/url';
import { loadFromUrl } from '../api/load';
import { encodeClip } from '../frames/codec';
import { assetId } from '../frames/assets';
import type { GraphData } from '../graphFile';

const link: DocLink = { docId: 'g1', name: 'A', baseRev: 2, savedHash: 'h' };

describe('doc status', () => {
  it('maps link + dirty + remote state', () => {
    expect(docStatus({ docId: null, name: '' }, true, null)).toBe('new');
    expect(docStatus(link, false, null)).toBe('saved');
    expect(docStatus(link, true, null)).toBe('unsaved');
    expect(docStatus(link, false, 'changed')).toBe('conflict');
    expect(docStatus(link, true, 'deleted')).toBe('deleted');
  });
});

describe('applyRemote (another tab changed the library)', () => {
  const msg = (m: Partial<LibraryMessage>): LibraryMessage => ({ type: 'saved', id: 'g1', from: 'other', ...m });
  it('ignores own messages and other graphs', () => {
    expect(applyRemote(link, null, msg({ from: 'me' }), 'me')).toEqual({});
    expect(applyRemote(link, null, msg({ id: 'g2', rev: 9 }), 'me')).toEqual({});
    expect(applyRemote({ docId: null, name: '' }, null, msg({ rev: 9 }), 'me')).toEqual({});
  });
  it('flags a newer save and a delete of the open graph', () => {
    expect(applyRemote(link, null, msg({ rev: 3 }), 'me')).toEqual({ remote: 'changed' });
    expect(applyRemote(link, null, msg({ type: 'deleted' }), 'me')).toEqual({ remote: 'deleted' });
  });
  it('an undo of the delete (same rev back) clears the deleted flag', () => {
    expect(applyRemote(link, 'deleted', msg({ rev: 2 }), 'me')).toEqual({ remote: null });
    expect(applyRemote(link, 'changed', msg({ rev: 2 }), 'me')).toEqual({ remote: 'changed' });
  });
});

describe('helpers', () => {
  it('relativeTime', () => {
    const now = Date.UTC(2026, 5, 15, 12);
    expect(relativeTime(now - 5000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60e3, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3600e3, now)).toBe('3 h ago');
    expect(relativeTime(now - 26 * 3600e3, now)).toBe('yesterday');
    expect(relativeTime(now - 3 * 86400e3, now)).toBe('3 days ago');
    expect(relativeTime(now - 40 * 86400e3, now)).toMatch(/\w/);
  });
  it('matchesQuery is case-insensitive and multi-word', () => {
    expect(matchesQuery('Damped Pendulum', 'pend damp')).toBe(true);
    expect(matchesQuery('Damped Pendulum', 'spring')).toBe(false);
    expect(matchesQuery('anything', '  ')).toBe(true);
  });
  it('fileNameFor', () => {
    expect(fileNameFor('Lotka–Volterra: v2')).toBe('LotkaVolterra-v2.json');
    expect(fileNameFor('???')).toBe('fluxion-graph.json');
  });
});

describe('thumbnail degrades gracefully', () => {
  it('returns undefined in node (no document / no canvas)', () => {
    expect(thumbnailOfPlot()).toBeUndefined();
    expect(makeThumbnail({ width: 100, height: 50 })).toBeUndefined();
    expect(makeThumbnail(null, { document: {} as never })).toBeUndefined();
  });
  it('returns undefined for a zero-sized canvas, a missing context, or a throwing encoder', () => {
    const doc = (ctx: unknown, url: () => string) => ({
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: url }) as unknown as HTMLCanvasElement,
    });
    const ctx = { drawImage: () => {} };
    expect(makeThumbnail({ width: 0, height: 10 }, { document: doc(ctx, () => 'data:image/png;base64,' + 'A'.repeat(40)) })).toBeUndefined();
    expect(makeThumbnail({ width: 10, height: 10 }, { document: doc(null, () => '') })).toBeUndefined();
    expect(
      makeThumbnail(
        { width: 10, height: 10 },
        {
          document: doc(ctx, () => {
            throw new Error('tainted');
          }),
        },
      ),
    ).toBeUndefined();
  });
  it('draws a centre-cropped cover image when a canvas is available', () => {
    const calls: number[][] = [];
    const out = { width: 0, height: 0, getContext: () => ({ drawImage: (_s: unknown, ...a: number[]) => calls.push(a) }), toDataURL: () => 'data:image/webp;base64,' + 'A'.repeat(40) };
    const url = makeThumbnail({ width: 800, height: 400 }, { document: { createElement: () => out as unknown as HTMLCanvasElement } });
    expect(url).toMatch(/^data:image\/webp/);
    expect(out.width).toBe(THUMB_W);
    expect(out.height).toBe(THUMB_H);
    // 800×400 → 240×150 (16:10) cover: crop width 640 centred (x=80), full height.
    expect(calls[0]).toEqual([80, 0, 640, 400, 0, 0, THUMB_W, THUMB_H]);
  });
});

describe('library channel', () => {
  it('is a no-op without BroadcastChannel / localStorage', () => {
    const ch = openLibraryChannel(() => {}, {} as typeof globalThis);
    expect(() => ch.post({ type: 'saved', from: 'x' })).not.toThrow();
    ch.close();
  });
  it('delivers messages between two BroadcastChannel endpoints', async () => {
    const got: LibraryMessage[] = [];
    const a = openLibraryChannel(() => {});
    const b = openLibraryChannel((m) => got.push(m));
    a.post({ type: 'saved', id: 'g1', rev: 2, from: 'tabA' });
    await new Promise((r) => setTimeout(r, 30));
    a.close();
    b.close();
    expect(got).toEqual([{ type: 'saved', id: 'g1', rev: 2, from: 'tabA' }]);
  });
});

describe('copy share link (saved / recent)', () => {
  it('hands the clipboard a pending ClipboardItem (Safari user activation)', async () => {
    const written: unknown[] = [];
    class FakeItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    let resolve!: (s: string) => void;
    const text = new Promise<string>((r) => (resolve = r));
    const p = copyPendingText(text, {
      navigator: { clipboard: { write: async (items: ClipboardItems) => void written.push(...items) } },
      ClipboardItem: FakeItem as unknown as typeof ClipboardItem,
    });
    // Written synchronously, before the link exists.
    expect(written).toHaveLength(1);
    resolve('https://x/#z=abc');
    await p;
    const blob = await (written[0] as FakeItem).items['text/plain'];
    expect(await blob.text()).toBe('https://x/#z=abc');
  });
  it('falls back to writeText, and fails without a clipboard', async () => {
    let got = '';
    await copyPendingText(Promise.resolve('L'), { navigator: { clipboard: { writeText: async (s: string) => void (got = s) } } });
    expect(got).toBe('L');
    await expect(copyPendingText(Promise.resolve('L'), {})).rejects.toThrow();
  });
  it('a saved graph (with a clip) round-trips through buildShareLink', async () => {
    const l = new GraphLibrary(memoryKV());
    const clip = encodeClip({ w: 4, h: 4, fps: 12, box: [-1, -1, 1, 1], frames: [[[[0, 0], [3, 0], [3, 3]]]] });
    const id = assetId(clip);
    const g: GraphData = {
      v: 1,
      entries: [
        { id: 'a', raw: 'y = k*sin(t)', color: '#c74440', visible: true, expanded: true },
        { id: 'b', raw: 'k=2', color: '#2d70b3', visible: true, expanded: true, frames: id },
      ],
      viewport: { tMin: -3, tMax: 3, yMin: -2, yMax: 2 },
      features: { extrema: true, xIntercepts: true, yIntercept: true, endpoints: false, discontinuities: true, intersections: true },
      projections: { rightOpen: true, bottomOpen: true, sliceT: 0, sliceY: 1 },
      sigFigs: 4,
      assets: { [id]: clip },
    };
    const rec = await l.save({ name: 'Share me', graph: g });
    const url = await buildShareLink(await l.toGraph(rec), 'https://fluxion.test/');
    expect(url.startsWith('https://fluxion.test/#')).toBe(true);
    expect(url).not.toContain('#g=');
    const back = await loadFromUrl(url.slice(url.indexOf('#')), '');
    expect(back?.graph?.entries.map((e) => e.raw)).toEqual(['y = k*sin(t)', 'k=2']);
    expect(back?.graph?.viewport).toEqual(g.viewport);
    expect(back?.graph?.assets?.[id]).toBe(clip);
  });
});
