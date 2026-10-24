import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';

// Node has no Web Storage or document; the store and the saved-graphs session use them.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let store: typeof import('../store/useStore');
let saved: typeof import('./savedGraphs');
beforeAll(async () => {
  Object.assign(globalThis, {
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    document: { addEventListener() {}, visibilityState: 'visible' },
    window: globalThis,
  });
  store = await import('../store/useStore');
  saved = await import('./savedGraphs');
});

describe('newGraph', () => {
  it("starts from default settings, not the previous graph's letterbox / hidden grid", async () => {
    const { DEFAULT_FEATURES, useStore } = store;
    useStore.setState({
      features: { ...DEFAULT_FEATURES, extrema: false, grid: false, aspect: 2.39, fps: 30 },
      projections: { rightOpen: false, bottomOpen: true, sliceT: 3, sliceY: 2, sliceTExpr: 'k' },
    });
    await saved.newGraph();
    const s = useStore.getState();
    expect(s.features).toEqual(DEFAULT_FEATURES);
    // Which panels are open is a preference and carries over; the cuts don't.
    expect(s.projections).toEqual({ rightOpen: false, bottomOpen: true, sliceT: 0, sliceY: 1 });
    expect(s.entries.map((e) => e.raw)).toEqual(['']);
  });
});
