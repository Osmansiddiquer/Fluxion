import { FrameSequence } from './codec';

/**
 * Content-addressed store for large entry payloads (frame sequences). Entries
 * hold only a short id (`Entry.frames`), so the per-tab persisted store — which
 * is rewritten on every slider tick during an animation — stays small. Assets
 * persist separately in localStorage (written once, on import) and travel inside
 * exported graph files (`GraphData.assets`).
 */

const KEY = 'fluxion-assets';
const mem = new Map<string, string>();
let loaded = false;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const ls = storage();
  if (!ls) return;
  try {
    const obj = JSON.parse(ls.getItem(KEY) ?? '{}') as Record<string, unknown>;
    for (const [id, data] of Object.entries(obj)) {
      if (typeof data === 'string' && !mem.has(id)) mem.set(id, data);
    }
  } catch {
    /* corrupt — ignore */
  }
}

function save(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(KEY, JSON.stringify(Object.fromEntries(mem)));
  } catch {
    /* quota exceeded: the asset still lives in memory for this session */
  }
}

/** FNV-1a 32-bit hash, as 8 hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Content id of a payload (stable for identical data). */
export function assetId(data: string): string {
  return `fx${hashString(data)}${data.length.toString(36)}`;
}

/** Store a payload; returns its content id. */
export function putAsset(data: string): string {
  load();
  const id = assetId(data);
  if (!mem.has(id)) {
    mem.set(id, data);
    save();
  }
  return id;
}

export function getAsset(id: string | undefined): string | undefined {
  if (!id) return undefined;
  load();
  return mem.get(id);
}

/** Add several assets (from an imported graph file). */
export function registerAssets(assets: Record<string, string> | undefined): void {
  if (!assets) return;
  load();
  let changed = false;
  for (const [id, data] of Object.entries(assets)) {
    if (typeof data === 'string' && !mem.has(id)) {
      mem.set(id, data);
      changed = true;
    }
  }
  if (changed) save();
}

/** The assets referenced by a set of ids (for export). */
export function assetsFor(ids: Iterable<string | undefined>): Record<string, string> {
  load();
  const out: Record<string, string> = {};
  for (const id of ids) {
    const d = id ? mem.get(id) : undefined;
    if (id && d) out[id] = d;
  }
  return out;
}

const sequences = new Map<string, FrameSequence | Error>();

/** The decoded (lazily) frame sequence for an asset id, or an Error. */
export function getFrameSequence(id: string | undefined): FrameSequence | Error {
  if (!id) return new Error('No frames imported for this entry');
  const hit = sequences.get(id);
  if (hit) return hit;
  const data = getAsset(id);
  if (!data) return new Error('Frame data not found — re-import the clip');
  let seq: FrameSequence | Error;
  try {
    seq = new FrameSequence(data);
  } catch (err) {
    seq = err instanceof Error ? err : new Error(String(err));
  }
  sequences.set(id, seq);
  return seq;
}

/** Test hook: forget everything held in memory. */
export function _resetAssets(): void {
  mem.clear();
  sequences.clear();
  loaded = false;
}
