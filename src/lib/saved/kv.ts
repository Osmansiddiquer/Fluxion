/**
 * A tiny key-value layer over IndexedDB, with drop-in fallbacks, so the saved
 * graphs library (library.ts) is storage-agnostic and unit-testable in node.
 *
 * Three backends, tried in order by `openBestKV`:
 *   1. IndexedDB  — large quota, async, survives restarts (the normal case);
 *   2. localStorage — when IndexedDB is missing / blocked (some private modes);
 *   3. memory     — nothing durable is available; graphs last for this tab only.
 */

/** The object stores the library uses. */
export const STORES = ['graphs', 'recent', 'assets'] as const;
export type StoreName = (typeof STORES)[number];

export type KVKind = 'indexeddb' | 'localstorage' | 'memory';

export interface KV {
  readonly kind: KVKind;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  put<T>(store: StoreName, key: string, value: T): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /**
   * Read-modify-write one key atomically (a single IndexedDB readwrite
   * transaction, so two tabs can't interleave). `fn` must be synchronous; return
   * `undefined` to leave the key untouched. Resolves to what `fn` returned.
   */
  update<T>(store: StoreName, key: string, fn: (old: T | undefined) => T | undefined): Promise<T | undefined>;
}

/** Thrown (in place of the backend's own error) when the browser is out of space. */
export class StorageFullError extends Error {
  constructor(message = 'Browser storage is full') {
    super(message);
    this.name = 'StorageFullError';
  }
}

/** Does this error mean "out of quota"? (Names vary by browser.) */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof StorageFullError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    /quota/i.test(e.message ?? '')
  );
}

const asStorageError = (err: unknown) => (isQuotaError(err) ? new StorageFullError() : err);

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function memoryKV(): KV {
  const data = new Map<StoreName, Map<string, string>>(STORES.map((s) => [s, new Map()]));
  const m = (s: StoreName) => data.get(s)!;
  return {
    kind: 'memory',
    async get<T>(s: StoreName, k: string) {
      const v = m(s).get(k);
      return v === undefined ? undefined : (JSON.parse(v) as T);
    },
    async getAll<T>(s: StoreName) {
      return [...m(s).values()].map((v) => JSON.parse(v) as T);
    },
    async keys(s) {
      return [...m(s).keys()];
    },
    async put(s, k, v) {
      m(s).set(k, JSON.stringify(v));
    },
    async delete(s, k) {
      m(s).delete(k);
    },
    async update<T>(s: StoreName, k: string, fn: (old: T | undefined) => T | undefined) {
      const raw = m(s).get(k);
      const next = fn(raw === undefined ? undefined : (JSON.parse(raw) as T));
      if (next !== undefined) m(s).set(k, JSON.stringify(next));
      return clone(next);
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage (or any Web Storage)
// ---------------------------------------------------------------------------

export function webStorageKV(ls: Storage, prefix = 'fluxion-lib'): KV {
  const key = (s: StoreName, k: string) => `${prefix}:${s}:${k}`;
  const read = <T>(s: StoreName, k: string): T | undefined => {
    const v = ls.getItem(key(s, k));
    if (v == null) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  };
  const write = (s: StoreName, k: string, v: unknown) => {
    try {
      ls.setItem(key(s, k), JSON.stringify(v));
    } catch (err) {
      throw asStorageError(err);
    }
  };
  const listKeys = (s: StoreName) => {
    const p = `${prefix}:${s}:`;
    const out: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(p)) out.push(k.slice(p.length));
    }
    return out;
  };
  return {
    kind: 'localstorage',
    async get<T>(s: StoreName, k: string) {
      return read<T>(s, k);
    },
    async getAll<T>(s: StoreName) {
      return listKeys(s)
        .map((k) => read<T>(s, k))
        .filter((v): v is T => v !== undefined);
    },
    async keys(s) {
      return listKeys(s);
    },
    async put(s, k, v) {
      write(s, k, v);
    },
    async delete(s, k) {
      ls.removeItem(key(s, k));
    },
    async update<T>(s: StoreName, k: string, fn: (old: T | undefined) => T | undefined) {
      const next = fn(read<T>(s, k));
      if (next !== undefined) write(s, k, next);
      return clone(next);
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

const DB_NAME = 'fluxion';
const DB_VERSION = 1;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asStorageError(tx.error));
    tx.onabort = () => reject(asStorageError(tx.error ?? new Error('Transaction aborted')));
  });

/** Open (creating / upgrading) the Fluxion database. Rejects if IndexedDB is unusable. */
export function openIDB(factory: IDBFactory, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(name, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => {
      const db = r.result;
      // Another tab upgrading the schema: step aside rather than block it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function idbKV(db: IDBDatabase): KV {
  const tx = (s: StoreName, mode: IDBTransactionMode) => db.transaction(s, mode);
  return {
    kind: 'indexeddb',
    async get<T>(s: StoreName, k: string) {
      return (await req(tx(s, 'readonly').objectStore(s).get(k))) as T | undefined;
    },
    async getAll<T>(s: StoreName) {
      return (await req(tx(s, 'readonly').objectStore(s).getAll())) as T[];
    },
    async keys(s) {
      return ((await req(tx(s, 'readonly').objectStore(s).getAllKeys())) as IDBValidKey[]).map(String);
    },
    async put(s, k, v) {
      const t = tx(s, 'readwrite');
      t.objectStore(s).put(v, k);
      await done(t);
    },
    async delete(s, k) {
      const t = tx(s, 'readwrite');
      t.objectStore(s).delete(k);
      await done(t);
    },
    async update<T>(s: StoreName, k: string, fn: (old: T | undefined) => T | undefined) {
      const t = tx(s, 'readwrite');
      const os = t.objectStore(s);
      let next: T | undefined;
      let fnError: unknown;
      const g = os.get(k);
      g.onsuccess = () => {
        try {
          next = fn(g.result as T | undefined);
          if (next !== undefined) os.put(next, k);
        } catch (err) {
          fnError = err;
          t.abort();
        }
      };
      try {
        await done(t);
      } catch (err) {
        throw fnError ?? err;
      }
      return next;
    },
  };
}

/** The best available backend for this environment. Never rejects. */
export async function openBestKV(env: { indexedDB?: IDBFactory; localStorage?: Storage } = globalThis): Promise<KV> {
  try {
    if (env.indexedDB) return idbKV(await openIDB(env.indexedDB));
  } catch {
    /* fall through */
  }
  try {
    const ls = env.localStorage;
    if (ls) {
      // Probe: some private modes expose localStorage but throw on write.
      ls.setItem('fluxion-lib-probe', '1');
      ls.removeItem('fluxion-lib-probe');
      return webStorageKV(ls);
    }
  } catch {
    /* fall through */
  }
  return memoryKV();
}
