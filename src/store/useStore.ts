import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppMode, Entry, FeatureToggles, Projections, ScriptDoc, ThemeMode, Viewport } from './types';
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

export const DEFAULT_FEATURES: FeatureToggles = {
  extrema: true,
  xIntercepts: true,
  yIntercept: true,
  endpoints: false,
  discontinuities: true,
  intersections: true,
};

export const DEFAULT_PROJECTIONS: Projections = {
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
  /** Script mode program (optional; absent = no script). */
  script?: ScriptDoc;
  /** Sidebar mode (optional; default graph). */
  mode?: AppMode;
  /** Script mode: re-run while typing (default true). */
  scriptAutoRun?: boolean;
  /** Script mode: reference panel open. */
  scriptDocsOpen?: boolean;
  /** Script mode: editor panel width (px). */
  scriptPanelWidth?: number;

  addEntry: () => void;
  /** Append `name = value` (default `1`; a point prompt passes `(0, 0)`). */
  addAssignment: (name: string, value?: string) => void;
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
    script?: ScriptDoc;
  }) => void;

  setMode: (m: AppMode) => void;
  setScriptCode: (code: string) => void;
  setScriptSlider: (name: string, value: number) => void;
  setScriptVisible: (visible: boolean) => void;
  addScriptClip: (name: string, assetId: string) => void;
  removeScriptClip: (name: string) => void;
  setScriptAutoRun: (on: boolean) => void;
  setScriptDocsOpen: (open: boolean) => void;
  setScriptPanelWidth: (w: number) => void;
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

      addAssignment: (name, value = '1') =>
        set((s) => {
          // Don't duplicate an existing definition of `name`.
          if (s.entries.some((e) => e.raw.trim().startsWith(`${name} =`) || e.raw.trim().startsWith(`${name}=`))) {
            return s;
          }
          const entry = makeEntry(`${name} = ${value}`, nextColor(s.entries.map((e) => e.color)));
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
          // A loaded graph replaces the script too (none → no script).
          script: g.script ? { ...g.script } : undefined,
        }));
      },
      setMode: (mode) => set({ mode }),
      setScriptCode: (code) => set((s) => ({ script: { ...s.script, code } })),
      setScriptSlider: (name, value) =>
        set((s) => ({ script: { code: '', ...s.script, sliders: { ...s.script?.sliders, [name]: value } } })),
      setScriptVisible: (visible) => set((s) => ({ script: { code: '', ...s.script, visible } })),
      addScriptClip: (name, assetId) =>
        set((s) => ({ script: { code: '', ...s.script, clips: { ...s.script?.clips, [name]: assetId } } })),
      removeScriptClip: (name) =>
        set((s) => {
          const clips = { ...s.script?.clips };
          delete clips[name];
          return { script: { code: '', ...s.script, clips } };
        }),
      setScriptAutoRun: (scriptAutoRun) => set({ scriptAutoRun }),
      setScriptDocsOpen: (scriptDocsOpen) => set({ scriptDocsOpen }),
      setScriptPanelWidth: (w) => set({ scriptPanelWidth: Math.round(Math.max(340, Math.min(1100, w))) }),
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
        script: s.script,
        mode: s.mode,
        scriptAutoRun: s.scriptAutoRun,
        scriptDocsOpen: s.scriptDocsOpen,
        scriptPanelWidth: s.scriptPanelWidth,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.sigFigs) applySigFigs(state.sigFigs);
      },
    },
  ),
);
