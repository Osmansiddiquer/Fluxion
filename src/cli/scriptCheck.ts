/**
 * Headless Script mode check for the CLI (and tests): runs a script at a few
 * clock times and reports errors (with lines) and what it drew.
 *
 * Scripts given to the CLI may come from anywhere (a pasted link), so they are
 * NOT run in this Node realm. The whole sandbox worker bundle — runtime, API,
 * Graph bridge — is evaluated inside a fresh `node:vm` context that holds only
 * objects created in that context (no `process`, `require`, host functions or
 * host objects to climb out through), and every call has a timeout, so an
 * endless loop is cut off. Data crosses the boundary only as JSON strings.
 */
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import type { GraphEntryData } from '../lib/script/protocol';

export interface ScriptCheckIssue {
  time: number;
  message: string;
  line?: number;
}

export interface ScriptCheckFrame {
  time: number;
  shapes: number;
  kinds: Record<string, number>;
  sliders: string[];
  logs: string[];
  animated: boolean;
  loop: number | null;
}

export interface ScriptCheckReport {
  ok: boolean;
  errors: ScriptCheckIssue[];
  frames: ScriptCheckFrame[];
}

export interface ScriptCheckOpts {
  /** Clock times to run at (default: 0, 1, 2.5). */
  times?: number[];
  /** Graph-mode expressions the script may read (graph.ode / fn / value). */
  entries?: GraphEntryData[];
  sliders?: Record<string, number>;
  view?: { xmin: number; xmax: number; ymin: number; ymax: number };
  /** Per-run time limit (ms). */
  timeoutMs?: number;
}

let bundle: Promise<string> | null = null;

/** The sandbox worker bundle (same build as vite.config.mjs `sandboxRuntime`). */
export function runtimeBundle(): Promise<string> {
  bundle ??= (async () => {
    const { build } = await import('esbuild');
    const entry = fileURLToPath(new URL('../lib/script/sandbox/worker.ts', import.meta.url));
    const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true });
    return r.outputFiles[0].text;
  })();
  return bundle;
}

// A minimal worker-like global scope, defined from *inside* the context.
const SHIM = `
  var self = globalThis;
  var __out = [];
  var __handler = null;
  globalThis.postMessage = function (m) { __out.push(JSON.stringify(m)); };
  globalThis.addEventListener = function (t, f) { if (t === 'message') __handler = f; };
  globalThis.performance = { now: function () { return Date.now(); } };
  globalThis.__send = function (json) { __handler({ data: JSON.parse(json) }); };
  globalThis.__take = function () { var o = __out; __out = []; return '[' + o.join(',') + ']'; };
`;

export async function checkScript(code: string, opts: ScriptCheckOpts = {}): Promise<ScriptCheckReport> {
  const source = await runtimeBundle();
  const timeout = opts.timeoutMs ?? 2000;
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false } });
  vm.runInContext(SHIM, ctx, { timeout: 1000 });
  vm.runInContext(source, ctx, { timeout: 10_000 });
  const send = (msg: unknown) => vm.runInContext(`__send(${JSON.stringify(JSON.stringify(msg))})`, ctx, { timeout });
  const take = () => JSON.parse(vm.runInContext('__take()', ctx, { timeout: 1000 }) as string) as Record<string, unknown>[];
  take(); // 'ready'

  send({ type: 'graph', entries: opts.entries ?? [], clips: [] });
  const errors: ScriptCheckIssue[] = [];
  const frames: ScriptCheckFrame[] = [];
  const times = opts.times ?? [0, 1, 2.5];
  for (const [i, time] of times.entries()) {
    const inputs = { time, sliders: opts.sliders ?? {}, view: opts.view ?? { xmin: -8, xmax: 8, ymin: -5, ymax: 5 }, theme: 'light' };
    try {
      send({ type: 'run', id: i + 1, inputs, ...(i === 0 ? { code } : {}) });
    } catch (err) {
      const timedOut = /timed out/i.test(String(err));
      errors.push({
        time,
        message: timedOut
          ? `the script ran for over ${timeout} ms without finishing — is there an endless loop?`
          : `the script crashed the runtime: ${String(err).slice(0, 200)}`,
      });
      break; // the context may be wedged; stop here
    }
    const [reply] = take() as { type: string; error?: { message: string; line?: number }; frame?: Record<string, unknown> }[];
    if (!reply) {
      errors.push({ time, message: 'no reply from the runtime' });
      continue;
    }
    if (reply.error) errors.push({ time, message: reply.error.message, ...(reply.error.line ? { line: reply.error.line } : {}) });
    const f = reply.frame as { items: { k: string }[]; sliders: { name: string }[]; logs: string[]; animated: boolean; loop: number | null } | undefined;
    if (f) {
      const kinds: Record<string, number> = {};
      for (const it of f.items) kinds[it.k] = (kinds[it.k] ?? 0) + 1;
      frames.push({ time, shapes: f.items.length, kinds, sliders: f.sliders.map((s) => s.name), logs: f.logs, animated: f.animated, loop: f.loop });
    }
    // A compile error repeats identically at every time.
    if (reply.error && !f) break;
  }
  return { ok: errors.length === 0, errors, frames };
}
