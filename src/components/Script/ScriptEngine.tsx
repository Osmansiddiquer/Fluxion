import { useEffect } from 'react';
import runtimeSource from 'virtual:fluxion-sandbox-runtime';
import { useStore } from '../../store/useStore';
import { useScriptRuntime } from '../../state/scriptRuntime';
import { computeSignature } from '../../state/signature';
import { SandboxHost } from '../../lib/script/sandbox/host';
import { SCRIPT_LIMITS, usesClock, type ClipMeta, type GraphEntryData, type ScriptInputs } from '../../lib/script/protocol';
import { getFrameSequence } from '../../lib/frames/assets';
import { graphEntryData } from '../../lib/script/protocol';
import type { Entry, ScriptDoc, ThemeMode, Viewport } from '../../store/types';

/** Re-run delay while typing (ms). */
const TYPE_DEBOUNCE = 350;

function resolvedTheme(t: ThemeMode): 'light' | 'dark' {
  if (t === 'system') return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}

export function graphData(entries: Entry[]): GraphEntryData[] {
  return entries.map(graphEntryData);
}

export function clipMetas(script: ScriptDoc | undefined): ClipMeta[] {
  const out: ClipMeta[] = [];
  for (const [name, id] of Object.entries(script?.clips ?? {})) {
    const seq = getFrameSequence(id);
    if (seq instanceof Error) continue;
    out.push({ name, id, frames: seq.count, fps: seq.header.fps, box: seq.header.box });
  }
  return out;
}

/** Does the output depend on the viewport (plot() samples the view; `view` reads it)? */
const usesView = (code: string) => /\b(?:view|plot)\b/.test(code);

/**
 * Runs the current script in the sandbox and keeps `useScriptRuntime` up to
 * date. Mounted (lazily) whenever there is a script or Script mode is open.
 * Renders nothing.
 */
export default function ScriptEngine() {
  useEffect(() => {
    const rt = useScriptRuntime;
    const host = new SandboxHost(runtimeSource, {
      onFrame(frame) {
        rt.setState({ frame, error: null, killed: false, lastMs: Math.max(frame.ms, 0), status: 'ready' });
      },
      onError(error, partial, info) {
        rt.setState((s) => ({
          error,
          killed: info.killed,
          // Keep showing the last good drawing while you fix a typo; a partial
          // frame only when there's nothing else.
          frame: s.frame ?? partial ?? null,
          playing: info.killed ? false : s.playing,
          status: info.killed ? 'killed' : 'ready',
        }));
      },
      onStatus(status) {
        if (status !== 'killed') rt.setState({ status });
      },
    });

    let code = useStore.getState().script?.code ?? '';
    const inputs = (): ScriptInputs => {
      const s = useStore.getState();
      const r = rt.getState();
      const vp: Viewport = s.viewport;
      const loop = r.frame?.loop;
      const time = loop ? ((r.time % loop) + loop) % loop : r.time;
      return {
        time,
        sliders: { ...s.script?.sliders },
        view: { xmin: vp.tMin, xmax: vp.tMax, ymin: vp.yMin, ymax: vp.yMax },
        theme: resolvedTheme(s.theme),
      };
    };
    const run = (timeout: number = SCRIPT_LIMITS.runTimeoutMs, force = false) => {
      if (!code.trim()) {
        rt.setState({ frame: null, error: null, killed: false });
        return;
      }
      if (rt.getState().killed && !force) return;
      host.run(code, inputs(), timeout);
    };

    // Graph-mode data the script can read.
    let sig = '';
    let clipKey = '';
    const syncGraph = () => {
      const s = useStore.getState();
      const nextSig = computeSignature(s.entries);
      const nextClips = JSON.stringify(s.script?.clips ?? {});
      if (nextSig === sig && nextClips === clipKey) return false;
      sig = nextSig;
      clipKey = nextClips;
      host.setGraph(graphData(s.entries), clipMetas(s.script));
      return true;
    };
    syncGraph();
    run();

    let typing = 0;
    const unsubStore = useStore.subscribe((s, prev) => {
      const nextCode = s.script?.code ?? '';
      if (nextCode !== code) {
        code = nextCode;
        rt.setState({ killed: false });
        window.clearTimeout(typing);
        if (!code.trim()) run();
        else if (s.scriptAutoRun !== false) typing = window.setTimeout(() => run(), TYPE_DEBOUNCE);
      }
      const graphChanged = (s.entries !== prev.entries || s.script?.clips !== prev.script?.clips) && syncGraph();
      const inputsChanged =
        s.script?.sliders !== prev.script?.sliders ||
        s.theme !== prev.theme ||
        (s.viewport !== prev.viewport && usesView(code));
      if (graphChanged || inputsChanged) run();
      if (s.script?.visible !== prev.script?.visible) kick();
    });

    // Run button / scrubbing.
    const unsubRt = rt.subscribe((s, prev) => {
      if (s.stopNonce !== prev.stopNonce) {
        host.stop();
        rt.setState({ killed: true, status: 'killed', error: { message: 'Stopped. Press Run to start again.' } });
        return;
      }
      if (s.runNonce !== prev.runNonce) {
        window.clearTimeout(typing);
        code = useStore.getState().script?.code ?? '';
        run(SCRIPT_LIMITS.runTimeoutMs, true);
      } else if (s.time !== prev.time && !s.playing) run();
      if (s.playing && !prev.playing) kick();
    });

    // The script clock: while playing and the script animates, advance time and
    // ask for a frame each animation frame (the host drops frames the worker
    // can't keep up with).
    let raf = 0;
    let last = 0;
    const animated = () => {
      const f = rt.getState().frame;
      return f ? f.animated : usesClock(code);
    };
    const tick = (now: number) => {
      raf = 0;
      const r = rt.getState();
      if (!r.playing || r.killed || !code.trim() || !animated() || useStore.getState().script?.visible === false) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (dt > 0) {
        let t = r.time + dt;
        const loop = r.frame?.loop;
        if (loop) t %= loop;
        rt.setState({ time: t });
        host.run(code, inputs(), SCRIPT_LIMITS.frameTimeoutMs);
      }
      raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // Start the clock when a frame says the script animates.
    const unsubFrame = rt.subscribe((s, prev) => {
      if (s.frame !== prev.frame && s.frame?.animated && s.playing) kick();
    });
    kick();

    return () => {
      window.clearTimeout(typing);
      if (raf) cancelAnimationFrame(raf);
      unsubStore();
      unsubRt();
      unsubFrame();
      host.destroy();
      rt.setState({ status: 'idle' });
    };
  }, []);
  return null;
}
