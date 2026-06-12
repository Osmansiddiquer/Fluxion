import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Entry, FeatureToggles, Projections, ThemeMode, Viewport } from './types';
import { nextColor } from '../utils/colors';
import { setSigFigs as applySigFigs } from '../lib/format';

let idCounter = 0;
function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `e${Date.now()}_${idCounter++}`;
}

function makeEntry(raw: string, color: string): Entry {
  // Expanded by default so IVP / variable sliders appear as soon as one is typed.
  return { id: makeId(), raw, color, visible: true, expanded: true };
}

const DEFAULT_VIEWPORT: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };

const DEFAULT_FEATURES: FeatureToggles = {
  extrema: true,
  xIntercepts: true,
  yIntercept: true,
  endpoints: false,
  discontinuities: true,
  intersections: true,
};

const DEFAULT_PROJECTIONS: Projections = {
  rightOpen: true,
  bottomOpen: true,
  sliceT: 0,
  sliceY: 1,
};

function seedEntries(): Entry[] {
  // A friendly first-run example: exponential growth from y(0)=1.
  const e = makeEntry("y' = y", '#c74440');
  e.t0 = 0;
  e.ic = [1];
  e.expanded = true;
  return [e, makeEntry('', '#2d70b3')];
}

export interface AppState {
  entries: Entry[];
  viewport: Viewport;
  features: FeatureToggles;
  projections: Projections;
  theme: ThemeMode;
  sidebarWidth: number;
  sigFigs: number;
  panelW: number;
  panelH: number;

  addEntry: () => void;
  addAssignment: (name: string) => void;
  updateEntry: (id: string, patch: Partial<Entry>) => void;
  removeEntry: (id: string) => void;
  reorderEntry: (id: string, toIndex: number) => void;

  setViewport: (vp: Viewport) => void;
  resetView: () => void;

  setFeatures: (patch: Partial<FeatureToggles>) => void;
  setProjections: (patch: Partial<Projections>) => void;
  setTheme: (theme: ThemeMode) => void;
  setSidebarWidth: (w: number) => void;
  setSigFigs: (n: number) => void;
  setPanelW: (w: number) => void;
  setPanelH: (h: number) => void;
  loadGraph: (g: {
    entries: Entry[];
    viewport: Viewport;
    features: FeatureToggles;
    projections: Projections;
    sigFigs: number;
  }) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      entries: seedEntries(),
      viewport: DEFAULT_VIEWPORT,
      features: DEFAULT_FEATURES,
      projections: DEFAULT_PROJECTIONS,
      theme: 'light',
      sidebarWidth: 360,
      sigFigs: 3,
      panelW: 248,
      panelH: 184,

      addEntry: () =>
        set((s) => ({
          entries: [
            ...s.entries,
            makeEntry('', nextColor(s.entries.map((e) => e.color))),
          ],
        })),

      addAssignment: (name) =>
        set((s) => {
          // Don't duplicate an existing definition of `name`.
          if (s.entries.some((e) => e.raw.trim().startsWith(`${name} =`) || e.raw.trim().startsWith(`${name}=`))) {
            return s;
          }
          const entry = makeEntry(`${name} = 1`, nextColor(s.entries.map((e) => e.color)));
          return { entries: [...s.entries, entry] };
        }),

      updateEntry: (id, patch) =>
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),

      removeEntry: (id) =>
        set((s) => {
          const entries = s.entries.filter((e) => e.id !== id);
          return { entries: entries.length ? entries : seedEntries().slice(1) };
        }),

      reorderEntry: (id, toIndex) =>
        set((s) => {
          const from = s.entries.findIndex((e) => e.id === id);
          if (from < 0) return s;
          const entries = s.entries.slice();
          const [moved] = entries.splice(from, 1);
          entries.splice(Math.max(0, Math.min(toIndex, entries.length)), 0, moved);
          return { entries };
        }),

      setViewport: (vp) => set({ viewport: vp }),
      resetView: () => set({ viewport: { ...DEFAULT_VIEWPORT } }),

      setFeatures: (patch) => set((s) => ({ features: { ...s.features, ...patch } })),
      setProjections: (patch) =>
        set((s) => ({ projections: { ...s.projections, ...patch } })),
      setTheme: (theme) => set({ theme }),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(260, Math.min(640, w)) }),
      setPanelW: (w) => set({ panelW: Math.max(160, Math.min(640, Math.round(w))) }),
      setPanelH: (h) => set({ panelH: Math.max(110, Math.min(500, Math.round(h))) }),
      loadGraph: (g) => {
        if (g.sigFigs) applySigFigs(g.sigFigs);
        set((s) => ({
          entries: g.entries ?? s.entries,
          viewport: g.viewport ?? s.viewport,
          features: g.features ?? s.features,
          projections: g.projections ?? s.projections,
          sigFigs: g.sigFigs ?? s.sigFigs,
        }));
      },
      setSigFigs: (n) => {
        const v = Math.max(1, Math.min(12, Math.round(n)));
        applySigFigs(v);
        set({ sigFigs: v });
      },
    }),
    {
      name: 'ode-plotter',
      version: 2,
      // Per-browser-tab state: read/write this tab's own sessionStorage so two
      // open tabs are independent. Mirror to localStorage too, so a *fresh* tab
      // (empty sessionStorage) starts from your last-edited graph and your work
      // survives a browser restart.
      storage: createJSONStorage(() => ({
        getItem: (name) => sessionStorage.getItem(name) ?? localStorage.getItem(name),
        setItem: (name, value) => {
          sessionStorage.setItem(name, value);
          try {
            localStorage.setItem(name, value);
          } catch {
            /* localStorage may be full / blocked; sessionStorage still holds this tab */
          }
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
          localStorage.removeItem(name);
        },
      })),
      partialize: (s) => ({
        entries: s.entries,
        viewport: s.viewport,
        features: s.features,
        projections: s.projections,
        theme: s.theme,
        sidebarWidth: s.sidebarWidth,
        sigFigs: s.sigFigs,
        panelW: s.panelW,
        panelH: s.panelH,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.sigFigs) applySigFigs(state.sigFigs);
      },
    },
  ),
);
