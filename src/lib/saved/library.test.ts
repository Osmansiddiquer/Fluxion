import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { GraphData } from '../graphFile';
import { assetId } from '../frames/assets';
import { encodeClip } from '../frames/codec';
import {
  GraphConflictError,
  GraphLibrary,
  describeGraph,
  detectConflict,
  graphHash,
  isTrivialGraph,
  sanitizeStored,
  stableStringify,
} from './library';
import { idbKV, isQuotaError, memoryKV, openBestKV, openIDB, StorageFullError, webStorageKV, type KV } from './kv';

const VP = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
const FEAT = { extrema: true, xIntercepts: true, yIntercept: true, endpoints: false, discontinuities: true, intersections: true };
const PROJ = { rightOpen: true, bottomOpen: true, sliceT: 0, sliceY: 1 };

function graph(...raws: string[]): GraphData {
  return {
    v: 1,
    entries: raws.map((raw, i) => ({ id: `e${i}`, raw, color: '#c74440', visible: true, expanded: true })),
    viewport: { ...VP },
    features: { ...FEAT },
    projections: { ...PROJ },
    sigFigs: 3,
  };
}

/** A library with a controllable clock and readable ids. */
function lib(kv: KV = memoryKV(), opts: { recentCap?: number } = {}) {
  let t = 1000;
  let n = 0;
  const l = new GraphLibrary(kv, { now: () => (t += 10), newId: () => `id${++n}`, ...opts });
  return l;
}

const clip = encodeClip({ w: 4, h: 4, fps: 12, box: [-1, -1, 1, 1], frames: [[[[0, 0], [3, 0], [3, 3]]], []] });
const clipId = assetId(clip);

describe('content hash', () => {
  it('stableStringify sorts keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}');
  });
  it('ignores entry ids, expanded state, key order and assets', () => {
    const a = graph("y' = y", 'k=2');
    const b: GraphData = JSON.parse(JSON.stringify(a));
    b.entries = b.entries.map((e, i) => ({ expanded: false, visible: e.visible, color: e.color, raw: e.raw, id: `other${i}` }));
    b.assets = { x: 'y' };
    expect(graphHash(a)).toBe(graphHash(b));
  });
  it('changes with content', () => {
    expect(graphHash(graph('y=t'))).not.toBe(graphHash(graph('y=t^2')));
    const moved = graph('y=t');
    moved.viewport.tMin = -9;
    expect(graphHash(moved)).not.toBe(graphHash(graph('y=t')));
  });
  it('labels and trivial graphs', () => {
    expect(describeGraph(graph('', "y' = y", 'a=1'))).toBe("y' = y,  a=1");
    expect(describeGraph(graph(''))).toBe('Empty graph');
    expect(isTrivialGraph(graph('', ''))).toBe(true);
    expect(isTrivialGraph(graph("y' = y", ''))).toBe(true);
    expect(isTrivialGraph(graph('y=sin(t)'))).toBe(false);
  });
});

describe('save / update / rename / duplicate / delete / undo', () => {
  it('saves a new graph and lists it newest-first', async () => {
    const l = lib();
    const a = await l.save({ name: '  Logistic  growth ', graph: graph("y' = y(1-y)") });
    const b = await l.save({ name: '', graph: graph('y=sin(t)') });
    expect(a).toMatchObject({ id: 'id1', name: 'Logistic growth', rev: 1 });
    expect(b.name).toBe('Untitled graph');
    expect((await l.list()).map((r) => r.id)).toEqual(['id2', 'id1']);
  });

  it('updates in place, bumping rev and keeping name / createdAt', async () => {
    const l = lib();
    const a = await l.save({ name: 'A', graph: graph('y=t'), thumb: 'data:image/png;base64,AAAA' });
    const a2 = await l.save({ id: a.id, graph: graph('y=t^2'), baseRev: a.rev });
    expect(a2).toMatchObject({ id: a.id, name: 'A', rev: 2, createdAt: a.createdAt });
    expect(a2.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(a2.thumb).toBeUndefined(); // content changed, no new thumb: drop the stale one
    expect(a2.graph.entries[0].raw).toBe('y=t^2');
    expect(await l.list()).toHaveLength(1);
  });

  it('keeps the thumbnail when re-saving unchanged content without one', async () => {
    const l = lib();
    const a = await l.save({ name: 'A', graph: graph('y=t'), thumb: 'data:image/png;base64,AAAA' });
    const a2 = await l.save({ id: a.id, graph: graph('y=t'), baseRev: 1 });
    expect(a2.thumb).toBe('data:image/png;base64,AAAA');
  });

  it('renames without bumping rev', async () => {
    const l = lib();
    const a = await l.save({ name: 'A', graph: graph('y=t') });
    const r = await l.rename(a.id, 'Better name');
    expect(r).toMatchObject({ name: 'Better name', rev: 1 });
    expect((await l.rename(a.id, '   '))!.name).toBe('Better name');
    expect(await l.rename('missing', 'x')).toBeUndefined();
  });

  it('duplicates under a new id', async () => {
    const l = lib();
    const a = await l.save({ name: 'A', graph: graph('y=t') });
    const c = await l.duplicate(a.id);
    expect(c).toMatchObject({ name: 'A (copy)', rev: 1 });
    expect(c!.id).not.toBe(a.id);
    expect(await l.list()).toHaveLength(2);
    expect(await l.duplicate('missing')).toBeUndefined();
  });

  it('deletes and restores (undo)', async () => {
    const l = lib();
    const a = await l.save({ name: 'A', graph: graph('y=t') });
    const removed = await l.remove(a.id);
    expect(removed?.id).toBe(a.id);
    expect(await l.list()).toHaveLength(0);
    await l.restore(removed!);
    expect(await l.get(a.id)).toEqual(a);
  });

  it('round-trips the script and future fields, and sanitizes known ones', async () => {
    const l = lib();
    const g = { ...graph('y=t'), script: { code: 'plot(t => t)' }, futureField: 7 } as GraphData;
    (g.entries[0] as unknown as Record<string, unknown>).color = 'javascript:alert(1)';
    g.viewport = { tMin: 5, tMax: 1, yMin: 0, yMax: 1 };
    const a = await l.save({ name: 'S', graph: g });
    const back = await l.toGraph(a);
    expect(back.script).toEqual({ code: 'plot(t => t)' });
    expect((back as { futureField?: number }).futureField).toBe(7);
    expect(back.entries[0].color).toMatch(/^#/);
    expect(back.viewport).toEqual(VP); // invalid viewport → default
  });

  it('sanitizeStored lets sanitizeGraph win for fields it knows', () => {
    const g = { ...graph('y=t'), sigFigs: 99, future: 1 } as unknown as GraphData;
    const out = sanitizeStored(g) as GraphData & { future?: number };
    expect(out.sigFigs).toBe(12);
    expect(out.future).toBe(1);
  });
});

describe('assets', () => {
  it('stores clips once by reference and restores them on load', async () => {
    const kv = memoryKV();
    const l = lib(kv);
    const g = graph('frames(1)');
    g.entries[0].frames = clipId;
    g.assets = { [clipId]: clip };
    const a = await l.save({ name: 'Clip', graph: g });
    const b = await l.save({ name: 'Clip 2', graph: g });
    expect(a.assetIds).toEqual([clipId]);
    expect(a.graph.assets).toBeUndefined(); // not inlined in the record
    expect(await kv.keys('assets')).toEqual([clipId]);
    const back = await l.toGraph(b);
    expect(back.assets).toEqual({ [clipId]: clip });
    expect(back.entries[0].frames).toBe(clipId);
  });

  it('drops a stored asset whose payload does not match its id (sanitizeAssets)', async () => {
    const kv = memoryKV();
    const l = lib(kv);
    const g = graph('frames(1)');
    g.entries[0].frames = clipId;
    g.assets = { [clipId]: clip };
    const a = await l.save({ name: 'Clip', graph: g });
    await kv.put('assets', clipId, 'tampered');
    expect((await l.toGraph(a)).assets).toBeUndefined();
  });

  it('garbage-collects assets nothing references', async () => {
    const kv = memoryKV();
    const l = lib(kv);
    const g = graph('frames(1)');
    g.entries[0].frames = clipId;
    g.assets = { [clipId]: clip };
    const a = await l.save({ name: 'Clip', graph: g });
    await kv.put('assets', 'fxdeadbeef1', 'orphan');
    expect(await l.gcAssets()).toBe(1);
    expect(await kv.keys('assets')).toEqual([clipId]);
    await l.remove(a.id);
    expect(await l.gcAssets()).toBe(1);
    expect(await kv.keys('assets')).toEqual([]);
  });
});

describe('scripted graphs (Script mode)', () => {
  const scripted = (code: string, extra: Partial<GraphData> = {}): GraphData =>
    ({ ...graph(''), script: { code, sliders: { speed: 2 }, clips: { dancer: clipId } }, assets: { [clipId]: clip }, ...extra }) as GraphData;

  it('saves, lists and reopens the script with its sliders and clips', async () => {
    const kv = memoryKV();
    const l = lib(kv);
    const rec = await l.save({ name: 'Dancer', graph: scripted('clip("dancer").draw()'), thumb: 'data:image/webp;base64,AAAA' });
    expect(rec.assetIds).toEqual([clipId]); // the script's clip is stored by reference too
    expect((await l.list())[0]).toMatchObject({ name: 'Dancer', thumb: 'data:image/webp;base64,AAAA' });
    const back = await l.toGraph(rec);
    expect(back.script).toEqual({ code: 'clip("dancer").draw()', sliders: { speed: 2 }, clips: { dancer: clipId } });
    expect(back.assets).toEqual({ [clipId]: clip }); // kept by sanitizeGraph: the script references it
    expect(await l.gcAssets()).toBe(0); // referenced, not collected
  });

  it('a script edit changes the content hash; a script-only graph is real work', async () => {
    expect(graphHash(scripted('a()'))).not.toBe(graphHash(scripted('b()')));
    expect(isTrivialGraph(scripted('a()'))).toBe(false);
    expect(describeGraph(scripted('a()'))).toBe('Script');
    const l = lib();
    const r = await l.pushRecent('s', scripted('a()'));
    expect(r).toMatchObject({ label: 'Script', assetIds: [clipId] });
    expect((await l.toGraph(r!)).script?.code).toBe('a()');
  });
});

describe('recent autosaves', () => {
  it('keeps one slot per session, overwritten as it edits', async () => {
    const l = lib();
    await l.pushRecent('tabA', graph('y=t'));
    await l.pushRecent('tabA', graph('y=t^2'));
    const r = await l.listRecent();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'tabA', label: 'y=t^2' });
  });

  it('dedupes by content across sessions', async () => {
    const l = lib();
    await l.pushRecent('tabA', graph('y=t'));
    await l.pushRecent('tabB', graph('y=t'));
    expect((await l.listRecent()).map((r) => r.id)).toEqual(['tabB']);
  });

  it('caps the list, evicting the oldest', async () => {
    const l = lib(memoryKV(), { recentCap: 3 });
    for (let i = 0; i < 5; i++) await l.pushRecent(`s${i}`, graph(`y=${i}t`));
    expect((await l.listRecent()).map((r) => r.id)).toEqual(['s4', 's3', 's2']);
  });

  it('skips trivial graphs and graphs identical to a saved one', async () => {
    const l = lib();
    expect(await l.pushRecent('a', graph(''))).toBeNull();
    await l.save({ name: 'Saved', graph: graph('y=t') });
    expect(await l.pushRecent('b', graph('y=t'))).toBeNull();
    expect(await l.listRecent()).toHaveLength(0);
  });

  it('removes and restores a recent item', async () => {
    const l = lib();
    await l.pushRecent('a', graph('y=t'));
    const rec = await l.removeRecent('a');
    expect(await l.listRecent()).toHaveLength(0);
    await l.restoreRecent(rec!);
    expect(await l.listRecent()).toHaveLength(1);
  });
});

/** A KV whose writes fail with a quota error while `full()` says so. */
function quotaKV(full: (store: string, value: unknown) => boolean): KV {
  const inner = memoryKV();
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  return {
    ...inner,
    kind: 'memory',
    get: inner.get.bind(inner),
    getAll: inner.getAll.bind(inner),
    keys: inner.keys.bind(inner),
    delete: inner.delete.bind(inner),
    async put(s, k, v) {
      if (full(s, v)) throw quota();
      return inner.put(s, k, v);
    },
    async update(s, k, fn) {
      return inner.update(s, k, (old) => {
        const next = fn(old as never);
        if (next !== undefined && full(s, next)) throw quota();
        return next;
      });
    },
  };
}

describe('quota errors', () => {
  it('recognises quota errors across browsers', () => {
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('boom'))).toBe(false);
  });

  it('retries a save without the thumbnail, then reports a clear StorageFullError', async () => {
    let allowNoThumb = true;
    const kv = quotaKV((s, v) => s === 'graphs' && (!!(v as { thumb?: string }).thumb || !allowNoThumb));
    const l = lib(kv);
    const a = await l.save({ name: 'A', graph: graph('y=t'), thumb: 'data:image/webp;base64,xx' });
    expect(a.thumb).toBeUndefined();
    allowNoThumb = false;
    await expect(l.save({ name: 'B', graph: graph('y=2t') })).rejects.toBeInstanceOf(StorageFullError);
    await expect(l.save({ name: 'B', graph: graph('y=2t') })).rejects.toThrow(/Export to file/);
  });

  it('evicts old recent items to make room, then gives up clearly', async () => {
    let cap = 2;
    const inner = memoryKV();
    const kv = quotaKV(() => false);
    // Count-based quota on the recent store.
    kv.put = async (s, k, v) => {
      if (s === 'recent' && !(await inner.get('recent', k)) && (await inner.keys('recent')).length >= cap) {
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      }
      return inner.put(s, k, v);
    };
    kv.get = inner.get.bind(inner);
    kv.getAll = inner.getAll.bind(inner);
    kv.keys = inner.keys.bind(inner);
    kv.delete = inner.delete.bind(inner);
    kv.update = inner.update.bind(inner);
    const l = lib(kv);
    await l.pushRecent('a', graph('y=1'));
    await l.pushRecent('b', graph('y=2'));
    await l.pushRecent('c', graph('y=3')); // full → evicts 'a'
    expect((await l.listRecent()).map((r) => r.id).sort()).toEqual(['b', 'c']);
    cap = 0;
    await expect(l.pushRecent('d', graph('y=4'))).rejects.toBeInstanceOf(StorageFullError);
  });

  it('localStorage backend maps quota errors', async () => {
    const ls = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      },
      removeItem: () => {},
      clear: () => {},
    } as Storage;
    await expect(webStorageKV(ls).put('graphs', 'x', { a: 1 })).rejects.toBeInstanceOf(StorageFullError);
  });
});

describe('cross-tab conflicts', () => {
  it('detectConflict', () => {
    expect(detectConflict(undefined, undefined)).toBeNull();
    expect(detectConflict({ rev: 3 }, 3)).toBeNull();
    expect(detectConflict({ rev: 4 }, 3)).toBe('changed');
    expect(detectConflict(undefined, 3)).toBe('deleted');
  });

  it('refuses to overwrite a newer version saved by another tab, unless forced', async () => {
    const kv = memoryKV(); // shared, like one IndexedDB seen by two tabs
    const tab1 = lib(kv);
    const tab2 = lib(kv);
    const a = await tab1.save({ name: 'Shared', graph: graph('y=t') });
    // Both tabs opened rev 1; tab 2 saves first.
    await tab2.save({ id: a.id, graph: graph('y=2t'), baseRev: 1, by: 'tab2' });
    const err = await tab1.save({ id: a.id, graph: graph('y=3t'), baseRev: 1, by: 'tab1' }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphConflictError);
    expect(err.reason).toBe('changed');
    expect(err.current).toMatchObject({ rev: 2, updatedBy: 'tab2' });
    expect((await tab1.get(a.id))!.graph.entries[0].raw).toBe('y=2t'); // untouched
    const forced = await tab1.save({ id: a.id, graph: graph('y=3t'), baseRev: 1, force: true });
    expect(forced.rev).toBe(3);
  });

  it('reports a graph deleted in another tab', async () => {
    const kv = memoryKV();
    const tab1 = lib(kv);
    const a = await tab1.save({ name: 'Gone', graph: graph('y=t') });
    await lib(kv).remove(a.id);
    const err = await tab1.save({ id: a.id, graph: graph('y=t'), baseRev: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphConflictError);
    expect(err.reason).toBe('deleted');
  });

  it('a rename in another tab does not block a content save, and is kept', async () => {
    const kv = memoryKV();
    const tab1 = lib(kv);
    const a = await tab1.save({ name: 'Old', graph: graph('y=t') });
    await lib(kv).rename(a.id, 'New');
    const saved = await tab1.save({ id: a.id, graph: graph('y=4t'), baseRev: 1 });
    expect(saved).toMatchObject({ name: 'New', rev: 2 });
  });
});

describe('IndexedDB backend (fake-indexeddb)', () => {
  it('runs the library end to end', async () => {
    const kv = idbKV(await openIDB(new IDBFactory()));
    expect(kv.kind).toBe('indexeddb');
    const l = lib(kv);
    const g = graph('frames(1)');
    g.entries[0].frames = clipId;
    g.assets = { [clipId]: clip };
    const a = await l.save({ name: 'IDB', graph: g });
    expect((await l.toGraph(a)).assets).toEqual({ [clipId]: clip });
    await l.pushRecent('s', graph('y=t'));
    expect(await l.listRecent()).toHaveLength(1);
    const err = await l.save({ id: a.id, graph: g, baseRev: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphConflictError);
    expect((await l.get(a.id))!.rev).toBe(1); // aborted transaction wrote nothing
    expect((await kv.keys('graphs')).length).toBe(1);
    await kv.delete('graphs', a.id);
    expect(await kv.get('graphs', a.id)).toBeUndefined();
  });

  it('openBestKV prefers IndexedDB, then localStorage, then memory', async () => {
    expect((await openBestKV({ indexedDB: new IDBFactory() })).kind).toBe('indexeddb');
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const store = new Map<string, string>();
    const ls = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage;
    const lsKV = await openBestKV({ indexedDB: broken, localStorage: ls });
    expect(lsKV.kind).toBe('localstorage');
    await lib(lsKV).save({ name: 'LS', graph: graph('y=t') });
    expect((await lib(lsKV).list())[0].name).toBe('LS');
    expect((await openBestKV({})).kind).toBe('memory');
  });
});
