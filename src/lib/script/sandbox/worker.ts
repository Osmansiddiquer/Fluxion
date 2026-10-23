/**
 * Sandbox worker entry. Bundled on its own (vite.config.mjs `sandboxRuntime`
 * plugin → a string), handed to the sandboxed iframe, and started there as a
 * blob: Worker. It runs user scripts with the drawing API and answers with
 * validated display lists. See CLAUDE.md "Script mode sandbox".
 *
 * Defence in depth: the iframe's CSP already blocks every network fetch
 * (connect-src 'none', no remote script-src), and the iframe has an opaque
 * origin (no storage / cookies of the app). Here we also remove the
 * network-ish globals before any user code can run.
 */
import { compileScript, runScript, toScriptError, type CompiledScript, type GraphBridge as GraphBridgeLike } from '../runtime';
import { createGraphBridge } from '../graphBridge';
import { sanitizeFrame, type ClipMeta, type GraphEntryData } from '../protocol';

const scope = self as unknown as Record<string, unknown>;
const post = (scope.postMessage as (m: unknown) => void).bind(self);
const listen = (scope.addEventListener as (t: string, f: (e: MessageEvent) => void) => void).bind(self);

const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'Worker',
  'SharedWorker',
  'WebTransport',
  'RTCPeerConnection',
  'Request',
  'Response',
  'FileReaderSync',
  'cookieStore',
  'storage',
];
for (const name of BLOCKED) {
  try {
    Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
  } catch {
    /* already locked */
  }
}
try {
  const nav = scope.navigator as Record<string, unknown> | undefined;
  if (nav) for (const k of ['sendBeacon', 'serviceWorker', 'storage', 'locks', 'permissions']) {
    try {
      Object.defineProperty(nav, k, { value: undefined, configurable: false });
    } catch {
      /* ignore */
    }
  }
} catch {
  /* ignore */
}
// User code can't speak for the runtime (the app validates everything anyway).
scope.postMessage = () => {};

let graphEntries: GraphEntryData[] = [];
let bridge: GraphBridgeLike | null = null;
let clips: ClipMeta[] = [];
let compiled: CompiledScript | null = null;
let compileError: ReturnType<typeof toScriptError> | null = null;

listen('message', (e: MessageEvent) => {
  const m = e.data as Record<string, unknown>;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'graph') {
    graphEntries = Array.isArray(m.entries) ? (m.entries as GraphEntryData[]) : [];
    clips = Array.isArray(m.clips) ? (m.clips as ClipMeta[]) : [];
    bridge = null; // rebuilt lazily on first use
    return;
  }
  if (m.type !== 'run' || typeof m.id !== 'number') return;
  const id = m.id;
  if (typeof m.code === 'string') {
    const c = compileScript(m.code);
    compiled = c.ok ? c.script : null;
    compileError = c.ok ? null : c.error;
  }
  if (!compiled) {
    post({ type: 'error', id, error: compileError ?? { message: 'Nothing to run' } });
    return;
  }
  // Build the Graph-mode bridge only when the script touches `graph`.
  const lazy: GraphBridgeLike = {
    value: (n) => get().value(n),
    fn: (n) => get().fn(n),
    ode: (n, k) => get().ode(n, k),
    names: () => get().names(),
  };
  const get = () => (bridge ??= createGraphBridge(graphEntries));
  const r = runScript(compiled, { inputs: m.inputs as never, graph: lazy, clips });
  // Re-validate here too: guarantees the frame is plain, cloneable data.
  const clean = sanitizeFrame(r.frame);
  if (!clean.ok) {
    post({ type: 'error', id, error: r.error ?? { message: clean.error } });
    return;
  }
  try {
    if (r.error) post({ type: 'error', id, error: r.error, frame: clean.frame });
    else post({ type: 'frame', id, frame: clean.frame });
  } catch (err) {
    post({ type: 'error', id, error: toScriptError(err) });
  }
});

post({ type: 'ready' });
