/**
 * Cross-tab notifications for the saved-graphs library: "graph X changed / was
 * deleted", so other tabs refresh their list and notice when the graph they're
 * editing moved on. BroadcastChannel where available, else `storage` events on a
 * localStorage ping key; a no-op when neither exists (node).
 */

export interface LibraryMessage {
  type: 'saved' | 'renamed' | 'deleted' | 'recent';
  /** The saved graph (or recent slot) affected. */
  id?: string;
  rev?: number;
  /** Sender's tab session id (receivers ignore their own messages). */
  from: string;
}

const NAME = 'fluxion-library';
const PING_KEY = 'fluxion-library-ping';

export interface LibraryChannel {
  post(msg: LibraryMessage): void;
  close(): void;
}

export function openLibraryChannel(onMessage: (m: LibraryMessage) => void, env: typeof globalThis = globalThis): LibraryChannel {
  const BC = (env as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (BC) {
    const bc = new BC(NAME);
    bc.onmessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object') onMessage(e.data as LibraryMessage);
    };
    return { post: (m) => bc.postMessage(m), close: () => bc.close() };
  }
  const ls = (() => {
    try {
      return env.localStorage;
    } catch {
      return undefined;
    }
  })();
  if (ls && typeof env.addEventListener === 'function') {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PING_KEY || !e.newValue) return;
      try {
        onMessage(JSON.parse(e.newValue).m as LibraryMessage);
      } catch {
        /* ignore */
      }
    };
    env.addEventListener('storage', onStorage);
    return {
      post: (m) => {
        try {
          ls.setItem(PING_KEY, JSON.stringify({ m, n: Math.random() }));
        } catch {
          /* full / blocked */
        }
      },
      close: () => env.removeEventListener('storage', onStorage),
    };
  }
  return { post: () => {}, close: () => {} };
}
