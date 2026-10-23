/**
 * App side of the Script mode sandbox.
 *
 *   app ──postMessage──▶ sandboxed <iframe srcdoc> ──postMessage──▶ blob: Worker
 *       ◀──────── validated display list ◀──────────── runtime.ts
 *
 * - The iframe has `sandbox="allow-scripts"` (no allow-same-origin), so it gets
 *   an opaque origin: no access to the app's DOM, cookies, localStorage or
 *   IndexedDB. Its CSP forbids every fetch, form, frame, image and remote script
 *   (`default-src 'none'`); scripts may only be inline (the bootstrap) or blob:
 *   (the worker), and workers inherit that policy.
 * - User code runs in a Worker inside it, so an endless loop never blocks the
 *   page. Every request has a watchdog; on timeout the whole iframe (and with
 *   it the worker) is thrown away and a fresh one is started.
 * - Messages are accepted only from that iframe's window and go through
 *   `parseRuntimeMessage` (protocol.ts) before anything is drawn.
 */
import {
  SCRIPT_LIMITS,
  parseRuntimeMessage,
  type ClipMeta,
  type GraphEntryData,
  type ScriptError,
  type ScriptFrame,
  type ScriptInputs,
} from '../protocol';

export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; " +
  "connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; " +
  "frame-src 'none'; child-src blob:; form-action 'none'; base-uri 'none'";

/** The iframe document: a relay between the app and the worker, nothing else. */
export const SANDBOX_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
</head><body><script>
(function () {
  var worker = null;
  var up = function (m) { parent.postMessage(m, '*'); };
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'boot') {
      if (worker || typeof m.runtime !== 'string') return;
      try {
        var url = URL.createObjectURL(new Blob([m.runtime], { type: 'text/javascript' }));
        worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = function (ev) { up(ev.data); };
        worker.onerror = function (ev) { ev.preventDefault(); up({ type: 'crash', message: String(ev.message || 'Script crashed') }); };
        worker.onmessageerror = function () { up({ type: 'crash', message: 'Unreadable message from the script' }); };
      } catch (err) {
        up({ type: 'crash', message: 'Could not start the script sandbox: ' + err });
      }
      return;
    }
    if (worker && (m.type === 'graph' || m.type === 'run')) worker.postMessage(m);
  });
  up({ type: 'iframe-ready' });
})();
</script></body></html>`;

export type HostStatus = 'starting' | 'ready' | 'running' | 'killed';

export interface HostCallbacks {
  onFrame(frame: ScriptFrame, info: { id: number; roundTripMs: number }): void;
  onError(error: ScriptError, frame: ScriptFrame | undefined, info: { id: number; killed: boolean }): void;
  onStatus?(status: HostStatus): void;
}

/** What the host needs from the page (injectable for tests). */
export interface HostEnv {
  doc: Pick<Document, 'createElement'> & { body: Pick<HTMLElement, 'appendChild'> };
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;
}

interface RunRequest {
  code: string;
  inputs: ScriptInputs;
  timeoutMs: number;
}

export function timeoutMessage(ms: number): string {
  const s = ms >= 1000 ? `${+(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  return `Stopped: the script ran for over ${s} without finishing — is there an endless loop? Fix it, then press Run.`;
}

/**
 * Owns one sandbox at a time. Requests are coalesced: while one is in flight
 * only the newest pending request is kept (an animation never queues up).
 */
export class SandboxHost {
  private iframe: HTMLIFrameElement | null = null;
  private ready = false;
  private booted = false;
  private inflight: { id: number; timer: number; sent: number; req: RunRequest } | null = null;
  private queued: RunRequest | null = null;
  private nextId = 1;
  private codeInWorker: string | null = null;
  private graph: { entries: GraphEntryData[]; clips: ClipMeta[] } = { entries: [], clips: [] };
  private destroyed = false;
  private readonly onMessage = (e: MessageEvent) => this.handle(e);
  private readonly doc: HostEnv['doc'];
  private readonly win: HostEnv['win'];

  constructor(
    private readonly runtimeSource: string,
    private readonly cb: HostCallbacks,
    env: HostEnv = { doc: document, win: window },
  ) {
    this.doc = env.doc;
    this.win = env.win;
    this.win.addEventListener('message', this.onMessage as EventListener);
    this.start();
  }

  private start(): void {
    this.ready = false;
    this.booted = false;
    this.codeInWorker = null;
    const f = this.doc.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('tabindex', '-1');
    f.title = 'Script sandbox';
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    f.srcdoc = SANDBOX_HTML;
    this.iframe = f;
    this.doc.body.appendChild(f);
    this.cb.onStatus?.('starting');
  }

  private post(m: unknown): void {
    this.iframe?.contentWindow?.postMessage(m, '*');
  }

  private handle(e: MessageEvent): void {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const d = e.data as { type?: unknown; message?: unknown } | null;
    if (d && d.type === 'iframe-ready') {
      if (!this.booted) {
        this.booted = true;
        this.post({ type: 'boot', runtime: this.runtimeSource });
      }
      return;
    }
    if (d && d.type === 'crash') {
      const message = typeof d.message === 'string' ? d.message.slice(0, SCRIPT_LIMITS.maxLogLine) : 'Script crashed';
      const id = this.inflight?.id ?? -1;
      this.restart();
      this.cb.onError({ message }, undefined, { id, killed: true });
      return;
    }
    const msg = parseRuntimeMessage(e.data);
    if (!msg) return;
    if (msg.type === 'ready') {
      this.ready = true;
      this.post({ type: 'graph', entries: this.graph.entries, clips: this.graph.clips });
      this.cb.onStatus?.('ready');
      this.pump();
      return;
    }
    if (!this.inflight || msg.id !== this.inflight.id) return; // stale
    this.win.clearTimeout(this.inflight.timer);
    const info = { id: msg.id, roundTripMs: performance.now() - this.inflight.sent };
    this.inflight = null;
    if (msg.type === 'frame') this.cb.onFrame(msg.frame, info);
    else if (msg.type === 'invalid') this.cb.onError({ message: msg.error }, undefined, { id: msg.id, killed: false });
    else this.cb.onError(msg.error, msg.frame, { id: msg.id, killed: false });
    this.pump();
  }

  private pump(): void {
    if (this.destroyed || !this.ready || this.inflight || !this.queued) return;
    const req = this.queued;
    this.queued = null;
    const id = this.nextId++;
    const sendCode = req.code !== this.codeInWorker;
    this.codeInWorker = req.code;
    const timer = this.win.setTimeout(() => this.timeout(id), req.timeoutMs);
    this.inflight = { id, timer, sent: performance.now(), req };
    this.cb.onStatus?.('running');
    this.post({ type: 'run', id, inputs: req.inputs, ...(sendCode ? { code: req.code } : {}) });
  }

  private timeout(id: number): void {
    if (!this.inflight || this.inflight.id !== id) return;
    const ms = this.inflight.req.timeoutMs;
    this.queued = null; // never re-run a script that just hung
    this.restart();
    this.cb.onStatus?.('killed');
    this.cb.onError({ message: timeoutMessage(ms) }, undefined, { id, killed: true });
  }

  private restart(): void {
    if (this.inflight) this.win.clearTimeout(this.inflight.timer);
    this.inflight = null;
    this.iframe?.remove(); // terminates the worker with it
    this.iframe = null;
    if (!this.destroyed) this.start();
  }

  /** Update the Graph-mode data and clips the script can read. */
  setGraph(entries: GraphEntryData[], clips: ClipMeta[]): void {
    this.graph = { entries, clips };
    if (this.ready) this.post({ type: 'graph', entries, clips });
  }

  /** Ask for a frame. Replaces any not-yet-sent request. */
  run(code: string, inputs: ScriptInputs, timeoutMs: number = SCRIPT_LIMITS.runTimeoutMs): void {
    this.queued = { code, inputs, timeoutMs };
    this.pump();
  }

  get busy(): boolean {
    return !!this.inflight || !!this.queued;
  }

  /** Kill whatever is running (user pressed Stop) and start a fresh sandbox. */
  stop(): void {
    this.queued = null;
    if (this.inflight) this.restart();
  }

  destroy(): void {
    this.destroyed = true;
    this.queued = null;
    if (this.inflight) this.win.clearTimeout(this.inflight.timer);
    this.inflight = null;
    this.win.removeEventListener('message', this.onMessage as EventListener);
    this.iframe?.remove();
    this.iframe = null;
  }
}
