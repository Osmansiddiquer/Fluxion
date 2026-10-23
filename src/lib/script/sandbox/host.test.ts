import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_CSP, SANDBOX_HTML, SandboxHost, timeoutMessage, type HostEnv } from './host';
import { DEFAULT_INPUTS } from '../testkit';

// A fake page: iframes are plain objects whose contentWindow records what the
// host posts; the test plays the iframe/worker by dispatching messages.
function fakeEnv() {
  const frames: { el: Record<string, unknown>; win: { posted: unknown[]; postMessage: (m: unknown) => void }; removed: boolean }[] = [];
  let listener: ((e: MessageEvent) => void) | null = null;
  const env: HostEnv = {
    doc: {
      createElement: (() => {
        const win = { posted: [] as unknown[], postMessage(m: unknown) { this.posted.push(m); } };
        const rec = { el: {} as Record<string, unknown>, win, removed: false };
        const el = {
          style: {},
          setAttribute: (k: string, v: string) => (rec.el[k] = v),
          contentWindow: win,
          remove: () => (rec.removed = true),
        } as unknown as HTMLIFrameElement;
        Object.defineProperty(el, 'srcdoc', { set: (v) => (rec.el.srcdoc = v) });
        frames.push(rec);
        return el;
      }) as unknown as Document['createElement'],
      body: { appendChild: ((x: Node) => x) as HTMLElement['appendChild'] },
    },
    win: {
      addEventListener: ((_t: string, f: (e: MessageEvent) => void) => (listener = f)) as Window['addEventListener'],
      removeEventListener: (() => (listener = null)) as Window['removeEventListener'],
      setTimeout: ((f: () => void, ms: number) => setTimeout(f, ms)) as unknown as Window['setTimeout'],
      clearTimeout: ((id: number) => clearTimeout(id)) as Window['clearTimeout'],
    },
  };
  const send = (data: unknown, i = frames.length - 1) => listener?.({ source: frames[i].win, data } as unknown as MessageEvent);
  const spoof = (data: unknown) => listener?.({ source: {}, data } as unknown as MessageEvent);
  return { env, frames, send, spoof, get listener() { return listener; } };
}

const frame = { items: [], sliders: [], logs: [], background: null, loop: null, ms: 1, animated: false };

function setup() {
  const f = fakeEnv();
  const onFrame = vi.fn();
  const onError = vi.fn();
  const onStatus = vi.fn();
  const host = new SandboxHost('RUNTIME', { onFrame, onError, onStatus }, f.env);
  const boot = () => {
    f.send({ type: 'iframe-ready' });
    f.send({ type: 'ready' });
  };
  return { f, host, onFrame, onError, onStatus, boot };
}

const posted = (f: ReturnType<typeof fakeEnv>, i = f.frames.length - 1) => f.frames[i].win.posted as Record<string, unknown>[];

describe('sandbox document', () => {
  it('is sandboxed with a no-network CSP', () => {
    const { f } = setup();
    expect(f.frames[0].el.sandbox).toBe('allow-scripts');
    expect(f.frames[0].el.srcdoc).toBe(SANDBOX_HTML);
    expect(SANDBOX_HTML).toContain(SANDBOX_CSP);
    for (const d of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "form-action 'none'", 'worker-src blob:']) {
      expect(SANDBOX_CSP).toContain(d);
    }
    expect(SANDBOX_CSP).not.toMatch(/https?:|'self'|\*/);
    expect(SANDBOX_HTML).toContain('e.source !== parent');
  });
});

describe('SandboxHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('boots the runtime, sends the graph, then runs', () => {
    const { f, host, onFrame, boot } = setup();
    host.setGraph([{ raw: 'k = 1', visible: true }], []);
    host.run('circle(0,0,1)', DEFAULT_INPUTS);
    expect(posted(f)).toEqual([]); // not ready yet
    boot();
    const p = posted(f);
    expect(p[0]).toEqual({ type: 'boot', runtime: 'RUNTIME' });
    expect(p[1]).toMatchObject({ type: 'graph', entries: [{ raw: 'k = 1' }] });
    expect(p[2]).toMatchObject({ type: 'run', id: 1, code: 'circle(0,0,1)' });
    f.send({ type: 'frame', id: 1, frame });
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('sends the code only when it changes', () => {
    const { f, host, boot } = setup();
    boot();
    host.run('a', DEFAULT_INPUTS);
    f.send({ type: 'frame', id: 1, frame });
    host.run('a', { ...DEFAULT_INPUTS, time: 1 });
    f.send({ type: 'frame', id: 2, frame });
    host.run('b', DEFAULT_INPUTS);
    const runs = posted(f).filter((m) => m.type === 'run');
    expect(runs.map((r) => 'code' in r)).toEqual([true, false, true]);
  });

  it('coalesces requests while one is in flight (only the newest runs next)', () => {
    const { f, host, boot } = setup();
    boot();
    host.run('a', { ...DEFAULT_INPUTS, time: 1 });
    host.run('a', { ...DEFAULT_INPUTS, time: 2 });
    host.run('a', { ...DEFAULT_INPUTS, time: 3 });
    expect(host.busy).toBe(true);
    f.send({ type: 'frame', id: 1, frame });
    const runs = posted(f).filter((m) => m.type === 'run');
    expect(runs.map((r) => (r.inputs as { time: number }).time)).toEqual([1, 3]);
  });

  it('kills a runaway script on timeout and starts a fresh sandbox', () => {
    const { f, host, onError, onStatus, boot } = setup();
    boot();
    host.run('while (true) {}', DEFAULT_INPUTS, 1000);
    host.run('while (true) {}', DEFAULT_INPUTS, 1000); // queued — must be dropped
    vi.advanceTimersByTime(999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe(timeoutMessage(1000));
    expect(onError.mock.calls[0][2]).toMatchObject({ killed: true });
    expect(onStatus).toHaveBeenCalledWith('killed');
    expect(f.frames).toHaveLength(2);
    expect(f.frames[0].removed).toBe(true);
    // The old iframe can't talk to us any more; the new one needs booting.
    f.send({ type: 'frame', id: 1, frame }, 0);
    expect(posted(f, 1)).toEqual([]);
    boot();
    expect(posted(f, 1).filter((m) => m.type === 'run')).toEqual([]); // nothing re-run by itself
    host.run('circle(0,0,1)', DEFAULT_INPUTS);
    expect(posted(f, 1).find((m) => m.type === 'run')).toMatchObject({ code: 'circle(0,0,1)' });
  });

  it('a late reply after the timeout is ignored', () => {
    const { f, host, onFrame, boot } = setup();
    boot();
    host.run('slow', DEFAULT_INPUTS, 500);
    vi.advanceTimersByTime(600);
    f.send({ type: 'frame', id: 1, frame }, 0);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('ignores messages from other windows and malformed messages', () => {
    const { f, host, onFrame, onError, boot } = setup();
    boot();
    host.run('a', DEFAULT_INPUTS);
    f.spoof({ type: 'frame', id: 1, frame });
    f.send({ type: 'frame', id: 99, frame });
    f.send({ type: 'eval', code: 'alert(1)' });
    f.send('frame');
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    f.send({ type: 'frame', id: 1, frame: { items: [{ k: 'point', x: 'NaN' }] } });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/rejected/);
  });

  it('a worker crash restarts the sandbox', () => {
    const { f, host, onError, boot } = setup();
    boot();
    host.run('a', DEFAULT_INPUTS);
    f.send({ type: 'crash', message: 'x'.repeat(5000) });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message.length).toBeLessThanOrEqual(1000);
    expect(f.frames).toHaveLength(2);
  });

  it('stop() kills an in-flight run; destroy() detaches', () => {
    const { f, host, boot } = setup();
    boot();
    host.run('a', DEFAULT_INPUTS);
    host.stop();
    expect(f.frames).toHaveLength(2);
    host.destroy();
    expect(f.frames[1].removed).toBe(true);
    expect(f.listener).toBeNull();
  });
});
