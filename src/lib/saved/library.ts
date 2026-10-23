import type { GraphData } from '../graphFile';
import { sanitizeGraph } from '../api/load';
import { hashString } from '../frames/assets';
import { isQuotaError, StorageFullError, type KV } from './kv';

/**
 * The saved-graphs library: named graphs the user keeps ("My graphs") plus a
 * capped, de-duplicated list of recent unsaved working graphs ("Recent"), on top
 * of a small KV backend (kv.ts — IndexedDB in the browser, memory in tests).
 *
 * Records hold the whole `GraphData` (so fields added later — e.g. a script —
 * round-trip), minus `assets`: frame-clip payloads are content-addressed and
 * stored once in their own store, referenced by id, so ten saves of a graph with
 * the same clip cost one copy.
 *
 * Concurrency: every saved graph has a `rev`, bumped on each content save. A tab
 * remembers the rev it opened / last saved (`baseRev`); saving with a stale
 * `baseRev` fails with GraphConflictError instead of overwriting a newer version
 * written by another tab. The check + write is one atomic KV update.
 */

export interface SavedGraph {
  id: string;
  name: string;
  /** The graph, without `assets` (see `assetIds`). */
  graph: GraphData;
  assetIds: string[];
  /** A small image of the plot (data URL), if one could be rendered. */
  thumb?: string;
  createdAt: number;
  updatedAt: number;
  /** Content revision, bumped on every save (not on rename). */
  rev: number;
  /** Content hash of `graph` (graphHash), for dirty checks and matching. */
  hash: string;
  /** The tab session that last saved it. */
  updatedBy?: string;
}

export interface RecentGraph {
  /** The working session (tab / "New graph") this autosave belongs to. */
  id: string;
  /** A readable label, from the graph's first expressions. */
  label: string;
  graph: GraphData;
  assetIds: string[];
  thumb?: string;
  updatedAt: number;
  hash: string;
}

export type ConflictReason = 'changed' | 'deleted';

/** Saving would overwrite a version another tab wrote (or it was deleted there). */
export class GraphConflictError extends Error {
  constructor(
    readonly reason: ConflictReason,
    readonly current?: SavedGraph,
  ) {
    super(reason === 'deleted' ? 'This graph was deleted in another tab' : 'This graph was changed in another tab');
    this.name = 'GraphConflictError';
  }
}

/**
 * Would writing over `stored` (what's in the library now) lose someone else's
 * work, given the tab last saw revision `baseRev`? null = safe to write.
 */
export function detectConflict(stored: Pick<SavedGraph, 'rev'> | undefined, baseRev: number | undefined): ConflictReason | null {
  if (baseRev === undefined) return null; // a brand-new graph
  if (!stored) return 'deleted';
  return stored.rev === baseRev ? null : 'changed';
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/** JSON with sorted keys and `undefined` dropped, so equal graphs stringify equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    return v === undefined ? 'null' : JSON.stringify(v) ?? 'null';
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Entry fields that are UI state, not content (excluded from the hash). */
const NON_CONTENT_ENTRY_KEYS = new Set(['id', 'expanded']);

/**
 * A content hash of a graph: what's drawn and how, independent of entry ids,
 * which rows are expanded, key order, and the asset payloads (assets are content
 * addressed, so their ids — already in the entries — stand in for them).
 */
export function graphHash(g: GraphData): string {
  const { assets: _assets, v: _v, ...rest } = g;
  const entries = (rest.entries ?? []).map((e) => {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(e ?? {})) if (!NON_CONTENT_ENTRY_KEYS.has(k)) out[k] = val;
    return out;
  });
  const s = stableStringify({ ...rest, entries });
  // Two FNV passes (forward + over a salted copy) ≈ 64 bits: plenty for dedupe.
  return `${hashString(s)}${hashString(`${s.length}:${s}`)}`;
}

/** A short readable label for an unnamed graph: its first expressions. */
export function describeGraph(g: GraphData, max = 48): string {
  const raws = (g.entries ?? []).map((e) => (e?.raw ?? '').trim()).filter(Boolean);
  const scriptCode = (g as { script?: { code?: string } }).script?.code?.trim();
  if (!raws.length) return scriptCode ? 'Script' : 'Empty graph';
  let s = raws.slice(0, 3).join(',  ');
  if (raws.length > 3) s += ', …';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Nothing worth keeping: blank rows, or just the first-run example. */
export function isTrivialGraph(g: GraphData): boolean {
  const raws = (g.entries ?? []).map((e) => (e?.raw ?? '').trim()).filter(Boolean);
  const scriptCode = (g as { script?: { code?: string } }).script?.code?.trim();
  if (scriptCode) return false;
  return raws.length === 0 || (raws.length === 1 && raws[0] === "y' = y");
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// Fields sanitizeGraph owns (dropped by it when invalid — never carried through raw).
const KNOWN_GRAPH_KEYS = new Set(['v', 'entries', 'viewport', 'features', 'projections', 'sigFigs', 'assets', 'script']);

/**
 * Sanitize a stored graph for loading. `sanitizeGraph` is the gatekeeper for the
 * fields it knows; top-level fields it doesn't know yet (added by newer
 * features, e.g. `script`) are carried through so they round-trip — once
 * `sanitizeGraph` learns a field, its sanitized value wins.
 */
export function sanitizeStored(g: GraphData): GraphData {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) if (!KNOWN_GRAPH_KEYS.has(k)) extra[k] = v;
  return { ...extra, ...sanitizeGraph(g) } as GraphData;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export interface LibraryOptions {
  now?: () => number;
  newId?: () => string;
  /** How many recent autosaves to keep. */
  recentCap?: number;
}

export interface SaveInput {
  /** Update this saved graph; omit to create a new one. */
  id?: string;
  /** New name; omitted on an update keeps the stored name. */
  name?: string;
  graph: GraphData;
  thumb?: string;
  /** The rev this tab last saw; a mismatch raises GraphConflictError. */
  baseRev?: number;
  /** Overwrite even if another tab changed it (the user said so). */
  force?: boolean;
  /** Which tab session is saving. */
  by?: string;
}

const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const cleanName = (n: string | undefined, fallback: string) => {
  const s = (n ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || fallback;
};

export const UNTITLED = 'Untitled graph';

export class GraphLibrary {
  readonly now: () => number;
  private readonly newId: () => string;
  readonly recentCap: number;

  constructor(
    readonly kv: KV,
    opts: LibraryOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.recentCap = opts.recentCap ?? 10;
  }

  /** Saved graphs, most recently updated first. */
  async list(): Promise<SavedGraph[]> {
    const all = await this.kv.getAll<SavedGraph>('graphs');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SavedGraph | undefined> {
    return this.kv.get<SavedGraph>('graphs', id);
  }

  /** Recent autosaves, newest first. */
  async listRecent(): Promise<RecentGraph[]> {
    const all = await this.kv.getAll<RecentGraph>('recent');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Split assets off a graph and store them (content-addressed, written once). */
  private async storeAssets(g: GraphData): Promise<{ graph: GraphData; assetIds: string[] }> {
    const { assets, ...graph } = g;
    const assetIds = Object.keys(assets ?? {});
    for (const id of assetIds) {
      const existing = await this.kv.get<string>('assets', id);
      if (existing === undefined) await this.kv.put('assets', id, assets![id]);
    }
    return { graph: graph as GraphData, assetIds };
  }

  /**
   * Create or update a saved graph. Throws GraphConflictError if another tab
   * saved (or deleted) it since `baseRev`, and StorageFullError when out of space
   * (after retrying once without the thumbnail).
   */
  async save(input: SaveInput): Promise<SavedGraph> {
    try {
      return await this.saveOnce(input);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      if (input.thumb) {
        try {
          return await this.saveOnce({ ...input, thumb: undefined });
        } catch (err2) {
          if (!isQuotaError(err2)) throw err2;
        }
      }
      throw new StorageFullError(
        'Not enough browser storage to save this graph. Delete some saved graphs, or use Export to file.',
      );
    }
  }

  private async saveOnce(input: SaveInput): Promise<SavedGraph> {
    const { graph, assetIds } = await this.storeAssets(input.graph);
    const id = input.id ?? this.newId();
    const t = this.now();
    const hash = graphHash(input.graph);
    const rec = await this.kv.update<SavedGraph>('graphs', id, (old) => {
      if (input.id && !input.force) {
        const c = detectConflict(old, input.baseRev);
        if (c) throw new GraphConflictError(c, old);
      }
      return {
        id,
        name: cleanName(input.name ?? old?.name, UNTITLED),
        graph,
        assetIds,
        // No new thumbnail (e.g. none could be rendered): keep the old one if the content is unchanged.
        thumb: input.thumb ?? (old?.hash === hash ? old?.thumb : undefined),
        createdAt: old?.createdAt ?? t,
        updatedAt: t,
        rev: (old?.rev ?? 0) + 1,
        hash,
        updatedBy: input.by,
      };
    });
    return rec!;
  }

  /** Rename (does not bump `rev`, so it never conflicts with a content save). */
  async rename(id: string, name: string): Promise<SavedGraph | undefined> {
    return this.kv.update<SavedGraph>('graphs', id, (old) =>
      old ? { ...old, name: cleanName(name, old.name), updatedAt: this.now() } : undefined,
    );
  }

  /** A copy of a saved graph under a new id ("<name> (copy)" by default). */
  async duplicate(id: string, name?: string): Promise<SavedGraph | undefined> {
    const src = await this.get(id);
    if (!src) return undefined;
    const t = this.now();
    const copy: SavedGraph = {
      ...src,
      id: this.newId(),
      name: cleanName(name, `${src.name} (copy)`),
      createdAt: t,
      updatedAt: t,
      rev: 1,
      updatedBy: undefined,
    };
    try {
      await this.kv.put('graphs', copy.id, copy);
    } catch (err) {
      if (isQuotaError(err)) throw new StorageFullError('Not enough browser storage to duplicate this graph.');
      throw err;
    }
    return copy;
  }

  /** Delete; returns the removed record so the caller can offer Undo (`restore`). */
  async remove(id: string): Promise<SavedGraph | undefined> {
    const old = await this.get(id);
    if (old) await this.kv.delete('graphs', id);
    return old;
  }

  /** Put a deleted record back (Undo). Its assets are still stored — GC runs only on `gcAssets`. */
  async restore(rec: SavedGraph): Promise<void> {
    await this.kv.put('graphs', rec.id, rec);
  }

  /** Rebuild a loadable, sanitized GraphData (with its assets) from a record. */
  async toGraph(rec: Pick<SavedGraph, 'graph' | 'assetIds'>): Promise<GraphData> {
    const assets: Record<string, string> = {};
    for (const id of rec.assetIds ?? []) {
      const d = await this.kv.get<string>('assets', id);
      if (typeof d === 'string') assets[id] = d;
    }
    const g: GraphData = { ...rec.graph };
    if (Object.keys(assets).length) g.assets = assets;
    return sanitizeStored(g);
  }

  /** A saved graph whose content equals `hash`, if any. */
  async findByHash(hash: string): Promise<SavedGraph | undefined> {
    return (await this.list()).find((r) => r.hash === hash);
  }

  /**
   * Record a working graph as a recent autosave for session `id`. One slot per
   * session (it's overwritten as that tab keeps editing); another slot holding
   * the same content is dropped (dedupe); a graph identical to a saved one, or
   * trivial, isn't kept. Oldest slots beyond `recentCap` are evicted — and
   * evicted early, one at a time, if the browser runs out of space.
   * Returns the record written, or null when skipped.
   */
  async pushRecent(id: string, g: GraphData, thumb?: string): Promise<RecentGraph | null> {
    if (isTrivialGraph(g)) {
      await this.kv.delete('recent', id);
      return null;
    }
    const hash = graphHash(g);
    if (await this.findByHash(hash)) {
      // Already safely saved under a name — no need for a recent copy.
      await this.kv.delete('recent', id);
      return null;
    }
    const existing = await this.listRecent();
    for (const r of existing) if (r.id !== id && r.hash === hash) await this.kv.delete('recent', r.id);

    const rec: RecentGraph = { id, label: describeGraph(g), graph: g, assetIds: [], thumb, updatedAt: this.now(), hash };
    const write = async (withThumb: boolean) => {
      const { graph, assetIds } = await this.storeAssets(g);
      const out = { ...rec, graph, assetIds, thumb: withThumb ? thumb : undefined };
      await this.kv.put('recent', id, out);
      return out;
    };

    let written: RecentGraph | null = null;
    const victims = existing.filter((r) => r.id !== id && r.hash !== hash).reverse(); // oldest first
    for (;;) {
      try {
        written = await write(true);
        break;
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        const v = victims.shift();
        if (v) {
          await this.kv.delete('recent', v.id);
          continue;
        }
        try {
          written = await write(false);
          break;
        } catch (err2) {
          if (isQuotaError(err2)) {
            throw new StorageFullError('Browser storage is full, so recent work could not be autosaved. Export or delete some graphs.');
          }
          throw err2;
        }
      }
    }
    const now = await this.listRecent();
    for (const r of now.slice(this.recentCap)) await this.kv.delete('recent', r.id);
    return written;
  }

  async getRecent(id: string): Promise<RecentGraph | undefined> {
    return this.kv.get<RecentGraph>('recent', id);
  }

  async removeRecent(id: string): Promise<RecentGraph | undefined> {
    const old = await this.getRecent(id);
    if (old) await this.kv.delete('recent', id);
    return old;
  }

  async restoreRecent(rec: RecentGraph): Promise<void> {
    await this.kv.put('recent', rec.id, rec);
  }

  /** Delete stored assets no saved graph or recent autosave references. */
  async gcAssets(): Promise<number> {
    const used = new Set<string>();
    for (const r of await this.kv.getAll<SavedGraph>('graphs')) for (const a of r.assetIds ?? []) used.add(a);
    for (const r of await this.kv.getAll<RecentGraph>('recent')) for (const a of r.assetIds ?? []) used.add(a);
    let n = 0;
    for (const k of await this.kv.keys('assets')) {
      if (!used.has(k)) {
        await this.kv.delete('assets', k);
        n++;
      }
    }
    return n;
  }
}
