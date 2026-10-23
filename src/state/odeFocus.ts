import { create } from 'zustand';

/**
 * Which entry row the pointer is over (not persisted). The plot draws that
 * row's ODE overlays (field, nullclines, equilibrium lines) a little stronger:
 * faint by default, emphasised on focus.
 */
export const useOdeFocus = create<{ id: string | null; set: (id: string | null) => void }>()((set) => ({
  id: null,
  set: (id) => set({ id }),
}));
