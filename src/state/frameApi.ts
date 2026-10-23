import { useStore } from '../store/useStore';
import { usePlayer } from './player';
import { entriesAtTime } from '../lib/anim';
import type { Entry } from '../store/types';

/**
 * `window.fluxion`: a tiny automation API for rendering exact frames without
 * the animation loop (rAF is throttled to ~1 fps in background / headless
 * tabs). Frame N is a pure function of N: every `autoplay` slider is set to its
 * value N / fps seconds after the graph opened (lib/anim `valueAt`), paused.
 *
 *   await fluxion.setFrame(120)        // fps from the graph (default 30)
 *   await fluxion.setTime(4.5)
 *   const png = fluxion.capture()      // data:image/png of the plot
 *
 * Both setters resolve once the plot has been redrawn.
 */
export interface FluxionFrameApi {
  version: 1;
  setTime(seconds: number): Promise<void>;
  setFrame(n: number, fps?: number): Promise<void>;
  capture(type?: string): string | null;
  info(): { fps: number; aspect: number | null; animated: string[]; drawn: number };
}

declare global {
  interface Window {
    fluxion?: FluxionFrameApi;
  }
}

export const DEFAULT_FPS = 30;

let drawn = 0;
const waiters: (() => void)[] = [];

/** Called by PlotCanvas after every redraw. */
export function notifyDrawn(): void {
  drawn++;
  for (const w of waiters.splice(0)) w();
}

function nextDraw(timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    waiters.push(finish);
    setTimeout(finish, timeoutMs); // nothing changed → no redraw: don't hang
  });
}

/** The graph as it was opened (start values + autoplay flags), per set of ids. */
let base: { sig: string; entries: Entry[] } | null = null;
const idSig = (es: Entry[]) => es.map((e) => e.id).join(',');

export function installFrameApi(): () => void {
  if (typeof window === 'undefined') return () => {};
  const api: FluxionFrameApi = {
    version: 1,
    async setTime(seconds: number) {
      const s = useStore.getState();
      if (!base || base.sig !== idSig(s.entries)) base = { sig: idSig(s.entries), entries: s.entries };
      usePlayer.getState().stopAll();
      const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const wait = nextDraw();
      useStore.setState({ entries: entriesAtTime(base.entries, t) });
      await wait;
    },
    setFrame(n: number, fps?: number) {
      const f = fps ?? useStore.getState().features.fps ?? DEFAULT_FPS;
      return api.setTime(Math.max(0, Math.floor(n)) / (f > 0 ? f : DEFAULT_FPS));
    },
    capture(type = 'image/png') {
      const c = document.querySelector<HTMLCanvasElement>('canvas.plot-canvas');
      try {
        return c ? c.toDataURL(type) : null;
      } catch {
        return null;
      }
    },
    info() {
      const s = useStore.getState();
      const src = base && base.sig === idSig(s.entries) ? base.entries : s.entries;
      return {
        fps: s.features.fps ?? DEFAULT_FPS,
        aspect: s.features.aspect ?? null,
        animated: src.filter((e) => e.autoplay).map((e) => e.id),
        drawn,
      };
    },
  };
  window.fluxion = api;
  // Remember each graph as opened (before playback moves its sliders).
  const snap = (es: Entry[]) => {
    const sig = idSig(es);
    if (!base || base.sig !== sig) base = { sig, entries: es };
  };
  snap(useStore.getState().entries);
  const unsub = useStore.subscribe((st, prev) => {
    if (st.entries !== prev.entries) snap(st.entries);
  });
  return () => {
    unsub();
    if (window.fluxion === api) delete window.fluxion;
  };
}
