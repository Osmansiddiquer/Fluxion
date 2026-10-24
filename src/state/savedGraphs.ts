import { create } from 'zustand';
import { DEFAULT_FEATURES, DEFAULT_PROJECTIONS, useStore } from '../store/useStore';
import { makeGraph, type GraphData } from '../lib/graphFile';
import { buildShareLink } from '../lib/api/url';
import { copyPendingText } from '../lib/saved/clipboard';
import { registerAssets } from '../lib/frames/assets';
import { DEFAULT_VIEWPORT } from '../lib/api/spec';
import { applyGraphDirect, setBeforeGraphReplace } from '../lib/saved/applyHook';
import { openBestKV, StorageFullError, type KVKind } from '../lib/saved/kv';
import {
  GraphConflictError,
  GraphLibrary,
  UNTITLED,
  graphHash,
  isTrivialGraph,
  type ConflictReason,
  type RecentGraph,
  type SavedGraph,
} from '../lib/saved/library';
import { openLibraryChannel, type LibraryChannel, type LibraryMessage } from '../lib/saved/channel';
import { applyRemote, fileNameFor, type DocLink, type RemoteState } from '../lib/saved/session';
import { thumbnailOfPlot } from '../lib/saved/thumbnail';

/**
 * Saved graphs, per tab: which saved graph this tab is editing (persisted in
 * sessionStorage, so a reload keeps it), whether it has unsaved changes, the
 * library lists, the toast, and every action the Graphs UI performs. The
 * storage itself is lib/saved (IndexedDB via a tiny KV wrapper).
 */

export interface SavedToast {
  msg: string;
  error?: boolean;
  undo?: () => void;
}

export interface Conflict {
  reason: ConflictReason;
  current?: SavedGraph;
}

interface SavedState extends DocLink {
  ready: boolean;
  storageKind: KVKind | null;
  dirty: boolean;
  remote: RemoteState;
  list: SavedGraph[];
  recent: RecentGraph[];
  /** The "My graphs" sheet; `focusName` focuses the name box (Ctrl+S on a new graph). */
  sheet: null | { focusName?: boolean };
  toast: SavedToast | null;
  conflict: Conflict | null;
  busy: boolean;
}

const DOC_KEY = 'fluxion-doc';

function readLink(): DocLink {
  try {
    const raw = sessionStorage.getItem(DOC_KEY);
    if (raw) {
      const d = JSON.parse(raw) as DocLink;
      if (d && typeof d === 'object' && (d.docId === null || typeof d.docId === 'string')) {
        return { docId: d.docId, name: typeof d.name === 'string' ? d.name : UNTITLED, baseRev: d.baseRev, savedHash: d.savedHash };
      }
    }
  } catch {
    /* no sessionStorage */
  }
  return { docId: null, name: UNTITLED };
}

function writeLink(l: DocLink) {
  try {
    sessionStorage.setItem(DOC_KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}

export const useSaved = create<SavedState>()(() => ({
  ...readLink(),
  ready: false,
  storageKind: null,
  dirty: false,
  remote: null,
  list: [],
  recent: [],
  sheet: null,
  toast: null,
  conflict: null,
  busy: false,
}));

const set = useSaved.setState;
const get = useSaved.getState;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** This page load (cross-tab message sender id). */
const TAB = newId();
/** The working graph's Recent slot — new per page load and on New / Open. */
let session = newId();

let lib: GraphLibrary | null = null;
let channel: LibraryChannel | null = null;
let ready: Promise<GraphLibrary> | null = null;

const current = (): GraphData => makeGraph(useStore.getState());

function setLink(l: Partial<DocLink>) {
  set(l);
  const s = get();
  writeLink({ docId: s.docId, name: s.name, baseRev: s.baseRev, savedHash: s.savedHash });
}

let toastTimer = 0;
export function flash(msg: string, opts: { error?: boolean; undo?: () => void } = {}) {
  set({ toast: { msg, ...opts } });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), opts.error || opts.undo ? 7000 : 2400);
}
export const dismissToast = () => set({ toast: null });

function errMsg(err: unknown, what: string): string {
  if (err instanceof StorageFullError) return err.message;
  return `Could not ${what}${err instanceof Error && err.message ? ` — ${err.message}` : ''}`;
}

async function refresh() {
  if (!lib) return;
  const [list, recent] = await Promise.all([lib.list(), lib.listRecent()]);
  set({ list, recent });
}

function post(m: Omit<LibraryMessage, 'from'>) {
  channel?.post({ ...m, from: TAB });
}

// ---------------------------------------------------------------------------
// Dirty tracking + Recent autosave
// ---------------------------------------------------------------------------

let hashTimer = 0;
let recentTimer = 0;

function recomputeDirty() {
  const s = get();
  const g = current();
  const h = graphHash(g);
  // An unsaved graph counts as work once edited (an example / link / import
  // opened untouched isn't): `savedHash` then holds its content as loaded.
  const dirty = h !== s.savedHash && (!!s.docId || !isTrivialGraph(g));
  if (dirty !== s.dirty) set({ dirty });
}

/** File the current working graph in Recent now (no-op if saved & clean, or trivial). */
export async function flushRecent(g: GraphData = current(), thumb = thumbnailOfPlot()): Promise<void> {
  window.clearTimeout(recentTimer);
  if (!lib) return;
  const s = get();
  if (graphHash(g) === s.savedHash) return; // unchanged since saved / loaded
  try {
    const r = await lib.pushRecent(session, g, thumb);
    if (r) post({ type: 'recent', id: r.id });
    await refresh();
  } catch (err) {
    if (err instanceof StorageFullError) flash(err.message, { error: true });
  }
}

function onGraphEdited() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(recomputeDirty, 200);
  window.clearTimeout(recentTimer);
  recentTimer = window.setTimeout(() => {
    if (get().dirty) void flushRecent();
  }, 2500);
}

// ---------------------------------------------------------------------------
// Loading a graph into this tab
// ---------------------------------------------------------------------------

/** Set while saved graphs itself replaces the graph, so the replace hook doesn't detach. */
let internalLoad = false;

function apply(g: GraphData) {
  internalLoad = true;
  try {
    if (!applyGraphDirect(g)) {
      registerAssets(g.assets); // must precede loadGraph (entries reference them)
      useStore.getState().loadGraph(g);
    }
  } finally {
    internalLoad = false;
  }
}

interface Snapshot {
  graph: GraphData;
  link: DocLink;
  session: string;
}
const snapshot = (): Snapshot => {
  const s = get();
  return { graph: current(), link: { docId: s.docId, name: s.name, baseRev: s.baseRev, savedHash: s.savedHash }, session };
};
function restore(snap: Snapshot) {
  apply(snap.graph);
  session = snap.session;
  setLink(snap.link);
  set({ remote: null });
  recomputeDirty();
}

/** Any other replacement (example, import, link, docs "Try it"): keep the old work in Recent, detach. */
function beforeExternalReplace() {
  if (internalLoad) return;
  const g = current();
  const thumb = thumbnailOfPlot();
  void flushRecent(g, thumb);
  session = newId();
  setLink({ docId: null, name: UNTITLED, baseRev: undefined, savedHash: undefined });
  set({ remote: null });
  // The caller loads the new graph synchronously right after this hook; then
  // remember its content as loaded, so an untouched example isn't "work".
  queueMicrotask(() => {
    const h = graphHash(current());
    setLink({ savedHash: h });
    recomputeDirty();
    // It may *be* a saved graph (e.g. Undo after opening an example): re-link it.
    void lib?.findByHash(h).then((rec) => {
      if (rec && !get().docId && graphHash(current()) === h) attach(rec, h);
    });
  });
}

function attach(rec: SavedGraph, hash: string) {
  setLink({ docId: rec.id, name: rec.name, baseRev: rec.rev, savedHash: hash });
  set({ remote: null, dirty: false });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function onMessage(m: LibraryMessage) {
  if (m.from === TAB) return;
  const s = get();
  const r = applyRemote(s, s.remote, m, TAB);
  if (r.remote !== undefined) set({ remote: r.remote });
  if (r.name !== undefined) setLink({ name: r.name });
  if (m.type === 'renamed' && m.id && m.id === s.docId) {
    void lib?.get(m.id).then((rec) => rec && setLink({ name: rec.name }));
  }
  void refresh();
}

/** Open the library (once) and wire up this tab. Safe to call repeatedly. */
export function initSaved(): Promise<GraphLibrary> {
  if (ready) return ready;
  ready = (async () => {
    const kv = await openBestKV();
    lib = new GraphLibrary(kv);
    set({ storageKind: kv.kind });
    channel = openLibraryChannel(onMessage);
    setBeforeGraphReplace(beforeExternalReplace);
    try {
      await lib.gcAssets();
    } catch {
      /* best effort */
    }
    await refresh();

    // Reconcile this tab's link with the library.
    const s = get();
    const g = current();
    const h = graphHash(g);
    if (s.docId) {
      const rec = await lib.get(s.docId);
      if (!rec) set({ remote: 'deleted' });
      else {
        if (rec.name !== s.name) setLink({ name: rec.name });
        if (rec.rev !== s.baseRev) set({ remote: 'changed' });
      }
    } else {
      // A fresh tab inherits the last-edited graph; if that's a saved one, say so.
      const rec = await lib.findByHash(h);
      if (rec) attach(rec, h);
    }
    recomputeDirty();
    useStore.subscribe((st, prev) => {
      if (
        st.entries !== prev.entries ||
        st.viewport !== prev.viewport ||
        st.features !== prev.features ||
        st.projections !== prev.projections ||
        st.sigFigs !== prev.sigFigs ||
        (st as { script?: unknown }).script !== (prev as { script?: unknown }).script
      ) {
        onGraphEdited();
      }
    });
    // Closing / hiding the tab: get the latest work into Recent.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && get().dirty) void flushRecent();
    });
    set({ ready: true });
    return lib;
  })();
  return ready;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const openSheet = (focusName = false) => set({ sheet: { focusName } });
export const closeSheet = () => set({ sheet: null });

export interface SaveOpts {
  /** Name for a new graph (first save / Save as copy). */
  name?: string;
  asCopy?: boolean;
  /** Overwrite another tab's newer version. */
  force?: boolean;
}

/** Save the current graph: in place if it's a saved graph, else as a new one. */
export async function saveCurrent(opts: SaveOpts = {}): Promise<boolean> {
  const l = await initSaved();
  const s = get();
  const g = current();
  const hash = graphHash(g);
  const thumb = thumbnailOfPlot();
  const inPlace = !!s.docId && !opts.asCopy;
  set({ busy: true });
  try {
    const rec = inPlace
      ? await l.save({ id: s.docId!, graph: g, thumb, baseRev: s.baseRev, force: opts.force, by: TAB, name: opts.name })
      : await l.save({
          name: opts.name ?? (opts.asCopy && s.docId ? `${s.name} (copy)` : s.name || UNTITLED),
          graph: g,
          thumb,
          by: TAB,
        });
    const prevSession = session;
    if (!inPlace) session = newId();
    attach(rec, hash);
    set({ conflict: null });
    await l.removeRecent(prevSession);
    post({ type: 'saved', id: rec.id, rev: rec.rev });
    await refresh();
    flash(inPlace ? `Saved “${rec.name}”` : opts.asCopy ? `Saved a copy as “${rec.name}”` : `Saved as “${rec.name}”`);
    return true;
  } catch (err) {
    if (err instanceof GraphConflictError) {
      set({ conflict: { reason: err.reason, current: err.current } });
    } else {
      flash(errMsg(err, 'save'), { error: true });
    }
    return false;
  } finally {
    set({ busy: false });
  }
}

/** Ctrl/Cmd+S: save in place, or ask for a name the first time. */
export function quickSave() {
  if (get().docId) void saveCurrent();
  else openSheet(true);
}

/** Replace the current graph with `g` (filing the old one in Recent), with Undo. */
async function replaceWith(g: GraphData, link: (h: string) => void, msg: string | ((filed: boolean) => string)) {
  const snap = snapshot();
  const filed = get().dirty; // unsaved work (new, or edits to a saved graph) goes to Recent
  await flushRecent(snap.graph);
  apply(g);
  session = newId();
  link(graphHash(current()));
  recomputeDirty();
  flash(typeof msg === 'string' ? msg : msg(filed), { undo: () => restore(snap) });
}

export async function openSaved(id: string) {
  const l = await initSaved();
  const rec = await l.get(id);
  if (!rec) {
    flash('That graph no longer exists', { error: true });
    await refresh();
    return;
  }
  const g = await l.toGraph(rec);
  await replaceWith(g, (h) => attach(rec, h), `Opened “${rec.name}”`);
  closeSheet();
}

export async function openRecent(id: string) {
  const l = await initSaved();
  const rec = await l.getRecent(id);
  if (!rec) return;
  const g = await l.toGraph(rec);
  await replaceWith(
    g,
    (h) => {
      setLink({ docId: null, name: UNTITLED, baseRev: undefined, savedHash: h });
      set({ remote: null });
    },
    'Opened recent work',
  );
  // Keep editing in that same Recent slot rather than spawning a duplicate.
  session = rec.id;
  closeSheet();
}

/** A blank graph; the current one stays safe in Recent (and Undo brings it back). */
export async function newGraph() {
  await initSaved();
  const s = useStore.getState();
  const blank: GraphData = {
    v: 1,
    entries: [{ id: newId(), raw: '', color: '#c74440', visible: true, expanded: true }],
    viewport: { ...DEFAULT_VIEWPORT },
    // Graph settings start fresh (a demo's hidden grid / markers or an
    // animation's letterbox and fps must not leak in); only which panels are
    // open and the sig-fig choice carry over, as preferences.
    features: { ...DEFAULT_FEATURES },
    projections: { ...DEFAULT_PROJECTIONS, rightOpen: s.projections.rightOpen, bottomOpen: s.projections.bottomOpen },
    sigFigs: s.sigFigs,
  };
  await replaceWith(
    blank,
    (h) => {
      setLink({ docId: null, name: UNTITLED, baseRev: undefined, savedHash: h });
      set({ remote: null });
    },
    (filed) => (filed ? 'New graph — the previous one is in Recent' : 'New graph'),
  );
  closeSheet();
}

/** Rename a saved graph (the one open here, or any in the list). */
export async function renameSaved(id: string, name: string) {
  const l = await initSaved();
  try {
    const rec = await l.rename(id, name);
    if (!rec) return;
    if (get().docId === id) setLink({ name: rec.name });
    post({ type: 'renamed', id });
    await refresh();
  } catch (err) {
    flash(errMsg(err, 'rename'), { error: true });
  }
}

/** The name of the graph open here; for an unsaved graph it's just the name its first save will use. */
export async function renameCurrent(name: string) {
  const s = get();
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean || clean === s.name) return;
  if (s.docId) await renameSaved(s.docId, clean);
  else setLink({ name: clean.slice(0, 120) });
}

export async function duplicateSaved(id: string) {
  const l = await initSaved();
  try {
    const rec = await l.duplicate(id);
    if (!rec) return;
    post({ type: 'saved', id: rec.id, rev: rec.rev });
    await refresh();
    flash(`Duplicated as “${rec.name}”`);
  } catch (err) {
    flash(errMsg(err, 'duplicate'), { error: true });
  }
}

export async function deleteSaved(id: string) {
  const l = await initSaved();
  const rec = await l.remove(id);
  if (!rec) return;
  const wasOpen = get().docId === id;
  const link = { docId: get().docId, name: get().name, baseRev: get().baseRev, savedHash: get().savedHash };
  if (wasOpen) {
    // Keep the graph on screen, now unsaved; Undo re-links it.
    setLink({ docId: null, baseRev: undefined, savedHash: undefined });
    recomputeDirty();
  }
  post({ type: 'deleted', id });
  await refresh();
  flash(`Deleted “${rec.name}”`, {
    undo: async () => {
      await l.restore(rec);
      if (wasOpen && get().docId === null) {
        setLink(link);
        recomputeDirty();
      }
      post({ type: 'saved', id: rec.id, rev: rec.rev });
      await refresh();
      set({ toast: null });
    },
  });
}

export async function deleteRecent(id: string) {
  const l = await initSaved();
  const rec = await l.removeRecent(id);
  if (!rec) return;
  post({ type: 'recent', id });
  await refresh();
  flash('Removed from Recent', {
    undo: async () => {
      await l.restoreRecent(rec);
      post({ type: 'recent', id });
      await refresh();
      set({ toast: null });
    },
  });
}

/** Keep a recent autosave as a named saved graph (without opening it). */
export async function keepRecent(id: string, name?: string) {
  const l = await initSaved();
  const rec = await l.getRecent(id);
  if (!rec) return;
  try {
    const g = await l.toGraph(rec);
    const saved = await l.save({ name: name ?? UNTITLED, graph: g, thumb: rec.thumb, by: TAB });
    await l.removeRecent(id);
    if (id === session) {
      session = newId();
      attach(saved, graphHash(current()));
    }
    post({ type: 'saved', id: saved.id, rev: saved.rev });
    await refresh();
    flash(`Saved as “${saved.name}”`);
  } catch (err) {
    flash(errMsg(err, 'save'), { error: true });
  }
}

async function graphOf(kind: 'saved' | 'recent', id: string): Promise<{ g: GraphData; name: string } | null> {
  const l = await initSaved();
  const rec = kind === 'saved' ? await l.get(id) : await l.getRecent(id);
  if (!rec) return null;
  return { g: await l.toGraph(rec), name: 'name' in rec ? rec.name : rec.label };
}

export async function exportGraph(kind: 'saved' | 'recent', id: string) {
  const r = await graphOf(kind, id);
  if (!r) return;
  const blob = new Blob([JSON.stringify(r.g, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileNameFor(r.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Copy a compact share link (lib/api buildShareLink) for a saved / recent graph. Not async
 * up front: the clipboard gets a pending item during the click (Safari), filled once the
 * graph is read and the link compressed. */
export function copyLink(kind: 'saved' | 'recent', id: string) {
  const base = `${location.origin}${location.pathname}`;
  const link = graphOf(kind, id).then((r) => {
    if (!r) throw new Error('That graph no longer exists');
    return buildShareLink(r.g, base);
  });
  return copyPendingText(link).then(
    () => flash('Share link copied to clipboard'),
    () => flash('Could not copy — clipboard blocked', { error: true }),
  );
}

/** Conflict prompt answers. */
export const resolveConflict = {
  overwrite: () => saveCurrent({ force: true }),
  saveCopy: () => {
    set({ conflict: null });
    return saveCurrent({ asCopy: true });
  },
  openTheirs: async () => {
    const id = get().docId;
    set({ conflict: null });
    if (id) await openSaved(id);
  },
  cancel: () => set({ conflict: null }),
};

/** Reload the version another tab saved (the banner's "Load latest"). */
export async function loadLatest() {
  const id = get().docId;
  if (id) await openSaved(id);
}
