import { create } from 'zustand';

/**
 * Which variable sliders are currently animating (and in which direction).
 * Session-only (not persisted). One shared rAF loop (components/AnimationLoop)
 * advances every playing slider and commits them in a single store update per
 * frame, so many animated variables cost one recompute — not one each.
 */
interface PlayerState {
  playing: Record<string, 1 | -1>;
  play: (id: string) => void;
  pause: (id: string) => void;
  toggle: (id: string) => void;
  setDir: (id: string, dir: 1 | -1) => void;
  stopAll: () => void;
}

export const usePlayer = create<PlayerState>()((set) => ({
  playing: {},
  play: (id) => set((s) => (s.playing[id] ? s : { playing: { ...s.playing, [id]: 1 } })),
  pause: (id) =>
    set((s) => {
      if (!s.playing[id]) return s;
      const next = { ...s.playing };
      delete next[id];
      return { playing: next };
    }),
  toggle: (id) =>
    set((s) => {
      const next = { ...s.playing };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return { playing: next };
    }),
  setDir: (id, dir) =>
    set((s) => (s.playing[id] && s.playing[id] !== dir ? { playing: { ...s.playing, [id]: dir } } : s)),
  stopAll: () => set({ playing: {} }),
}));
