import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import PlotCanvas from './components/Plot/PlotCanvas';
import Sidebar from './components/Sidebar/Sidebar';
import RightPanel from './components/Projections/RightPanel';
import BottomPanel from './components/Projections/BottomPanel';
import Logo from './components/Logo';
import ThemeToggle from './components/ThemeToggle';
import SigFigs from './components/SigFigs';
import GraphMenu from './components/GraphMenu';
import GraphsTitle from './components/Graphs/GraphsTitle';
import SavedGraphs from './components/Graphs/SavedGraphs';
import Tutorial from './components/Tutorial';
import HelpMenu, { type HelpMenuHandle } from './components/HelpMenu';
import { parseDocsHash } from './components/Docs/hash';
import Resizer from './components/Resizer';
import AnimationLoop from './components/AnimationLoop';
import ModeSwitch from './components/ModeSwitch';
import { ResultsProvider } from './state/results';
import { useStore } from './store/useStore';
import { APP_NAME } from './config';
import { hasUrlPayload } from './lib/api/url';
import './App.css';

// `?tour` opens the getting-started tour (the docs page's "Take the tour" link).
const wantsTour = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('tour');
// Script mode (editor, reference, sandbox runtime) loads on demand, so Graph mode's
// first load doesn't pay for it.
const ScriptPanel = lazy(() => import('./components/Script/ScriptPanel'));
const ScriptEngine = lazy(() => import('./components/Script/ScriptEngine'));

export default function App() {
  const resetView = useStore((s) => s.resetView);
  const theme = useStore((s) => s.theme);
  const mode = useStore((s) => s.mode ?? 'graph');
  const hasScript = useStore((s) => !!s.script?.code.trim());

  // On phones the sidebar becomes a slide-in drawer; on desktop CSS keeps it
  // docked and this flag is irrelevant. Closed by default so the graph leads.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const helpRef = useRef<HelpMenuHandle>(null);

  // The getting-started tour auto-opens once per browser; the ? menu reopens it.
  // Not over a graph someone linked you to (share / API link) — show the graph.
  const [tour, setTour] = useState(
    () =>
      wantsTour() ||
      (typeof localStorage !== 'undefined' &&
        !localStorage.getItem('fluxion-tour-seen') &&
        !hasUrlPayload(location.hash, location.search) &&
        !parseDocsHash(location.hash)),
  );
  const closeTour = () => {
    try {
      localStorage.setItem('fluxion-tour-seen', '1');
    } catch {
      /* private mode — fine, it just reopens next visit */
    }
    setTour(false);
    helpRef.current?.focus();
  };
  // Drop `?tour` from the address bar once honoured (keep any other params).
  useEffect(() => {
    if (!wantsTour()) return;
    const q = new URLSearchParams(location.search);
    q.delete('tour');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }, []);

  // Apply the theme during render (before child effects read CSS vars), so canvases
  // redraw with the correct palette the moment the theme changes.
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;

  return (
    <ResultsProvider>
      <div className="app">
        <header className="topbar">
          <button
            className="icon-btn sidebar-toggle"
            title={sidebarOpen ? 'Hide the panel' : mode === 'script' ? 'Show the script' : 'Show expressions'}
            aria-label="Toggle expressions panel"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <div className="brand">
            <Logo />
            <span className="brand-name">{APP_NAME}</span>
            <span className="beta-tag">beta</span>
          </div>
          <ModeSwitch />
          <GraphsTitle />
          <div className="topbar-spacer" />
          <HelpMenu ref={helpRef} onTour={() => setTour(true)} />
          <a
            className="icon-btn report-bug"
            href="https://github.com/Osmansiddiquer/Fluxion/issues"
            target="_blank"
            rel="noopener noreferrer"
            title="Report a bug or request a feature"
            aria-label="Report a bug"
          >
            <BugIcon />
          </a>
          <GraphMenu />
          <SigFigs />
          <ThemeToggle />
          <button className="icon-btn" title="Reset view" onClick={resetView}>
            ⤢
          </button>
        </header>
        <div className="body">
          {mode === 'script' ? (
            <Suspense fallback={<aside className="sidebar script-panel-loading" style={{ width: 500 }} />}>
              <ScriptPanel open={sidebarOpen} />
            </Suspense>
          ) : (
            <Sidebar open={sidebarOpen} />
          )}
          <Resizer />
          <main className="stage">
            <div className="top-row">
              <PlotCanvas />
              <RightPanel />
            </div>
            <BottomPanel />
          </main>
          {sidebarOpen && (
            <div
              className="sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
        </div>
        <Tutorial open={tour} onClose={closeTour} />
        <AnimationLoop />
        <SavedGraphs />
        {(hasScript || mode === 'script') && (
          <Suspense fallback={null}>
            <ScriptEngine />
          </Suspense>
        )}
      </div>
    </ResultsProvider>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 5h13M2.5 9h13M2.5 13h13"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 5.5 a3.2 3.2 0 0 1 3.2 3.2 v1.6 a3.2 3.2 0 0 1 -6.4 0 V8.7 A3.2 3.2 0 0 1 9 5.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 6 6.2 4.6 M10.8 6 11.8 4.6 M5.8 9.5 H3.4 M12.2 9.5 H14.6 M6 12.4 4.6 13.6 M12 12.4 13.4 13.6 M9 5.6 V14.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 4l10 10M14 4L4 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
