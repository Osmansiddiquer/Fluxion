import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { usePlayer } from '../state/player';
import { autoplayIds, stepPlaying } from '../state/animate';

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
      if (dt > 0) {
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
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.entries !== prev.entries) startAuto();
    });
    kick();
    return () => {
      unsubPlayer();
      unsubStore();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
