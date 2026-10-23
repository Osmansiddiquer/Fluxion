import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { usePlayer } from '../state/player';
import { autoplayIds, stepPlaying, valuesAtFrame } from '../state/animate';
import { frameAt } from '../lib/anim';
import { parseEntry } from '../lib/math/parse';
import { installFrameApi } from '../state/frameApi';

/**
 * The single animation clock for variable sliders. While anything is playing it
 * runs one rAF loop that advances all playing variables and writes them in ONE
 * store update per frame. Also starts `autoplay` variables (demos) once each.
 * Renders nothing.
 */
export default function AnimationLoop() {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const player = usePlayer.getState();
      if (!Object.keys(player.playing).length) {
        raf = 0;
        last = 0;
        return;
      }
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      const fps = useStore.getState().features.fps;
      if (fps && fps > 0) {
        stepFixed(now, fps, player);
      } else if (dt > 0) {
        const { values, dirs, stopped } = stepPlaying(useStore.getState().entries, player.playing, dt);
        if (values.size) {
          useStore.setState((s) => ({
            entries: s.entries.map((e) => (values.has(e.id) ? { ...e, varValue: values.get(e.id) } : e)),
          }));
        }
        for (const [id, d] of dirs) player.setDir(id, d);
        for (const id of stopped) player.pause(id);
      }
      raf = requestAnimationFrame(tick);
    };
    // Fixed-fps playback: each playing slider has its own clock (start value +
    // start time); its value at frame n is valueAt(start, n / fps) — a pure
    // function of n — and the store is only written when the frame number
    // changes. A value changed by someone else (drag, edit, setTime) restarts it.
    const clocks = new Map<string, { start: number; t0: number; n: number; last: number }>();
    const stepFixed = (now: number, fps: number, player: ReturnType<typeof usePlayer.getState>) => {
      const entries = useStore.getState().entries;
      const byId = new Map(entries.map((e) => [e.id, e]));
      const ids = Object.keys(player.playing);
      for (const id of [...clocks.keys()]) if (!player.playing[id]) clocks.delete(id);
      const due: string[] = [];
      const starts = new Map<string, number>();
      const frameOf = new Map<string, number>();
      for (const id of ids) {
        const e = byId.get(id);
        const p = e ? parseEntry(e.raw) : null;
        const cur = e && p?.kind === 'variable' ? (e.varValue ?? p.value) : NaN;
        let c = clocks.get(id);
        if (!c || c.last !== cur) {
          c = { start: cur, t0: now, n: 0, last: cur };
          clocks.set(id, c);
        }
        const n = frameAt((now - c.t0) / 1000, fps);
        if (n === c.n) continue;
        c.n = n;
        due.push(id);
        starts.set(id, c.start);
        frameOf.set(id, n);
      }
      if (!due.length) return;
      const values = new Map<string, number>();
      const stopped: string[] = [];
      for (const id of due) {
        const r = valuesAtFrame(entries, [id], starts, frameOf.get(id)!, fps);
        for (const [k, v] of r.values) values.set(k, v);
        for (const [k, d] of r.dirs) player.setDir(k, d);
        stopped.push(...r.stopped);
      }
      for (const [id, v] of values) clocks.get(id)!.last = v;
      useStore.setState((s) => ({
        entries: s.entries.map((e) => (values.has(e.id) ? { ...e, varValue: values.get(e.id) } : e)),
      }));
      for (const id of stopped) player.pause(id);
    };
    const kick = () => {
      if (!raf && Object.keys(usePlayer.getState().playing).length) raf = requestAnimationFrame(tick);
    };
    const unsubPlayer = usePlayer.subscribe(kick);

    // Autoplay: each flagged variable starts once per id (a freshly loaded graph
    // brings new ids, so demos start playing as soon as they're opened).
    const started = new Set<string>();
    const startAuto = () => {
      for (const id of autoplayIds(useStore.getState().entries, started)) {
        started.add(id);
        usePlayer.getState().play(id);
      }
    };
    startAuto();
    const uninstall = installFrameApi();
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.entries !== prev.entries) startAuto();
    });
    kick();
    return () => {
      unsubPlayer();
      unsubStore();
      uninstall();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
