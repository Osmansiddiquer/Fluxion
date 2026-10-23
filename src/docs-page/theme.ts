// Theme for the docs page: shares the app's saved preference. The app persists its
// store as JSON under `ode-plotter` (per-tab sessionStorage, mirrored to
// localStorage); the theme is `state.theme`. The inline script in index.html
// applies it before first paint; this module reads and changes it afterwards.
import type { ThemeMode } from '../store/types';

const STORE_KEY = 'ode-plotter';
const DOCS_KEY = 'fluxion-docs-theme';
const MODES: ThemeMode[] = ['light', 'dark', 'system'];

const isMode = (v: unknown): v is ThemeMode => MODES.includes(v as ThemeMode);

function storeTheme(storage: Storage): ThemeMode | null {
  try {
    const raw = storage.getItem(STORE_KEY);
    const t = raw ? JSON.parse(raw)?.state?.theme : null;
    return isMode(t) ? t : null;
  } catch {
    return null;
  }
}

/** The saved theme: the app's (this tab, then any tab), else the docs' own, else system. */
export function readTheme(): ThemeMode {
  try {
    const own = localStorage.getItem(DOCS_KEY);
    return storeTheme(sessionStorage) ?? storeTheme(localStorage) ?? (isMode(own) ? own : 'system');
  } catch {
    return 'system';
  }
}

/** Apply a theme and save it where the app will read it too. */
export function writeTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    let wroteStore = false;
    for (const storage of [localStorage, sessionStorage]) {
      const raw = storage.getItem(STORE_KEY);
      if (!raw) continue;
      const blob = JSON.parse(raw);
      if (!blob || typeof blob !== 'object' || !blob.state) continue;
      blob.state.theme = mode;
      storage.setItem(STORE_KEY, JSON.stringify(blob));
      wroteStore = true;
    }
    if (!wroteStore) localStorage.setItem(DOCS_KEY, mode);
  } catch {
    /* storage blocked — the choice just lasts for this page view */
  }
}
