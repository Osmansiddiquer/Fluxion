import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Build the real worker bundle (as vite.config.mjs does) and run it in a fresh
// VM context that mimics a worker global scope.
const ENTRY = fileURLToPath(new URL('./worker.ts', import.meta.url));
let source = '';

beforeAll(async () => {
  const r = await build({ entryPoints: [ENTRY], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true });
  source = r.outputFiles[0].text;
}, 60_000);

function boot() {
  const out: Record<string, unknown>[] = [];
  let onMessage: ((e: { data: unknown }) => void) | null = null;
  const g: Record<string, unknown> = {
    postMessage: (m: Record<string, unknown>) => out.push(m),
    addEventListener: (t: string, f: (e: { data: unknown }) => void) => {
      if (t === 'message') onMessage = f;
    },
    fetch: () => 'network!',
    XMLHttpRequest: function () {},
    importScripts: () => 'loaded!',
    WebSocket: function () {},
    indexedDB: {},
    navigator: { sendBeacon: () => true, userAgent: 'test' },
    performance,
  };
  g.self = g;
  const ctx = vm.createContext(g);
  vm.runInContext(source, ctx, { timeout: 10_000 });
  const send = (data: unknown) => onMessage!({ data });
  return { out, send, ctx, g };
}

describe('sandbox worker bundle', () => {
  it('is self-contained (no imports) and reasonably small', () => {
    expect(source.startsWith('(()=>{')).toBe(true);
    expect(source).not.toMatch(/^(?:import|export) /m);
    expect(source.length).toBeLessThan(1_500_000);
  });

  it('announces ready, then runs scripts and answers with frames', () => {
    const { out, send } = boot();
    expect(out[0]).toEqual({ type: 'ready' });
    send({ type: 'graph', entries: [{ raw: "y'' = -y", visible: true, ic: [1, 0] }], clips: [] });
    send({
      type: 'run',
      id: 7,
      code: 'circle(0, 0, 1, { fill: "red" }); print(graph.ode("y")(Math.PI).toFixed(3))',
      inputs: { time: 0, sliders: {}, view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 }, theme: 'light' },
    });
    const reply = out[1] as { type: string; id: number; frame: { items: unknown[]; logs: string[] } };
    expect(reply.type).toBe('frame');
    expect(reply.id).toBe(7);
    expect(reply.frame.items).toHaveLength(1);
    expect(reply.frame.logs).toEqual(['-1.000']);
  });

  it('removes network and storage globals before user code runs', () => {
    const { out, send } = boot();
    send({
      type: 'run',
      id: 1,
      code: [
        'const g = (0, eval)("this")',
        'print(typeof g.fetch, typeof g.XMLHttpRequest, typeof g.importScripts, typeof g.WebSocket, typeof g.indexedDB, typeof g.navigator.sendBeacon)',
        'try { g.fetch = () => 1 } catch (e) { print("locked") }',
        'print(typeof g.fetch)',
      ].join('\n'),
      inputs: { time: 0, sliders: {}, view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 }, theme: 'light' },
    });
    const reply = out[1] as { frame: { logs: string[] } };
    expect(reply.frame.logs[0]).toBe('undefined undefined undefined undefined undefined undefined');
    expect(reply.frame.logs.at(-1)).toBe('undefined');
  });

  it('user code cannot post messages as the runtime', () => {
    const { out, send } = boot();
    send({
      type: 'run',
      id: 1,
      code: 'self.postMessage({ type: "frame", id: 2, frame: {} }); postMessage("x")',
      inputs: { time: 0, sliders: {}, view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 }, theme: 'light' },
    });
    // Only the real reply gets through (postMessage is a no-op for user code).
    expect(out.slice(1).map((m) => [m.type, m.id])).toEqual([['frame', 1]]);
  });

  it('reports compile errors and runtime errors with lines', () => {
    const { out, send } = boot();
    const inputs = { time: 0, sliders: {}, view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 }, theme: 'light' };
    send({ type: 'run', id: 1, code: 'circle(0, 0,', inputs });
    send({ type: 'run', id: 2, code: 'circle(0, 0, 1)\nnope()', inputs });
    const [a, b] = out.slice(1) as { type: string; error: { message: string; line?: number }; frame?: { items: unknown[] } }[];
    expect(a.type).toBe('error');
    expect(a.error.message).toMatch(/SyntaxError/);
    expect(b.error.line).toBe(2);
    expect(b.frame?.items).toHaveLength(1);
  });
});
