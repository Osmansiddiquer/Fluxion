import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useScriptRuntime } from '../../state/scriptRuntime';
import { registerAssets } from '../../lib/frames/assets';
import { DEMOS } from '../../lib/demos';
import type { SliderDecl } from '../../lib/script/protocol';
import CodeEditor from './CodeEditor';
import { focusLine, trySnippet } from './scriptBus';
import { DOCS_SIDE_MIN, DOCS_W, SCRIPT_PANEL_W } from './layout';
import './ScriptPanel.css';

const ScriptDocs = lazy(() => import('./ScriptDocs'));
const ClipImporter = lazy(() => import('./ClipImporter'));

const STARTERS: { label: string; code: string }[] = [
  {
    label: 'A circle',
    code: '// Shapes use the same axes as the graph.\ncircle(0, 0, 2, { fill: "tomato", color: "black", width: 3 })\n',
  },
  {
    label: 'Animated',
    code: '// Scripts that use `time` animate. Press ❚❚ to pause.\nconst a = time\nfor (const k of range(8)) {\n  const q = a + k * TAU / 8\n  circle(3 * cos(q), 3 * sin(q), 0.5, { fill: hsv(45 * k, 0.7, 0.95) })\n}\n',
  },
  {
    label: 'With a slider',
    code: 'const n = slider("petals", 2, 12, 5, 1)\ncurve(t => [2.5 * cos(n * t) * cos(t), 2.5 * cos(n * t) * sin(t)], 0, TAU, {\n  color: "#6042a6", fill: alpha("#6042a6", 0.15), samples: 600,\n})\n',
  },
];

function useWide(min: number) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

export default function ScriptPanel({ open = false }: { open?: boolean }) {
  const code = useStore((s) => s.script?.code ?? '');
  const setCode = useStore((s) => s.setScriptCode);
  const autoRun = useStore((s) => s.scriptAutoRun !== false);
  const setAutoRun = useStore((s) => s.setScriptAutoRun);
  const docsOpen = useStore((s) => !!s.scriptDocsOpen);
  const setDocsOpen = useStore((s) => s.setScriptDocsOpen);
  const base = useStore((s) => s.scriptPanelWidth ?? SCRIPT_PANEL_W);
  const error = useScriptRuntime((s) => s.error);
  const requestRun = useScriptRuntime((s) => s.requestRun);
  const replaced = useScriptRuntime((s) => s.replaced);
  const wide = useWide(DOCS_SIDE_MIN);
  const [clipsOpen, setClipsOpen] = useState(false);

  const side = docsOpen && wide;
  const width = base + (side ? DOCS_W : 0);

  return (
    <aside
      className={`sidebar script-panel${open ? ' sidebar-open' : ''}${docsOpen && !side ? ' docs-overlay' : ''}`}
      style={{ width }}
      aria-label="Script editor"
    >
      <div className="sp-row">
        <section className="sp-main" style={side ? { width: base } : undefined}>
          <Toolbar
            autoRun={autoRun}
            setAutoRun={setAutoRun}
            onRun={requestRun}
            docsOpen={docsOpen}
            toggleDocs={() => setDocsOpen(!docsOpen)}
            openClips={() => setClipsOpen(true)}
          />
          {replaced && <ReplacedBanner previous={replaced} />}
          <div className="sp-editor">
            <CodeEditor value={code} onChange={setCode} onRun={requestRun} error={error} />
            {!code.trim() && <Starters openDocs={() => setDocsOpen(true)} />}
          </div>
          <Sliders />
          <Clock />
          <Console />
        </section>
        {docsOpen && (
          <section className="sp-docs" aria-label="Scripting reference">
            <div className="sp-docs-head">
              <span className="sp-docs-title">Scripting reference</span>
              <button className="icon-btn" title="Close the reference" aria-label="Close the reference" onClick={() => setDocsOpen(false)}>
                ✕
              </button>
            </div>
            <Suspense fallback={<div className="sp-docs-loading">Loading…</div>}>
              <ScriptDocs />
            </Suspense>
          </section>
        )}
      </div>
      {clipsOpen && (
        <Suspense fallback={null}>
          <ClipImporter onClose={() => setClipsOpen(false)} />
        </Suspense>
      )}
    </aside>
  );
}

function Toolbar(p: {
  autoRun: boolean;
  setAutoRun: (b: boolean) => void;
  onRun: () => void;
  docsOpen: boolean;
  toggleDocs: () => void;
  openClips: () => void;
}) {
  const status = useScriptRuntime((s) => s.status);
  const running = status === 'running' || status === 'starting';
  const [slow, setSlow] = useState(false);
  // Show Stop only when a run has been going for a while.
  useEffect(() => {
    if (!running) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(id);
  }, [running]);
  const clipCount = useStore((s) => Object.keys(s.script?.clips ?? {}).length);
  return (
    <div className="sp-toolbar" role="toolbar" aria-label="Script controls">
      {slow ? (
        <button className="sp-btn danger" onClick={stopScript} title="Stop the running script">
          <span aria-hidden="true">■</span> Stop
        </button>
      ) : (
        <button className="sp-btn primary" onClick={p.onRun} title="Run the script (Ctrl+Enter)">
          <span aria-hidden="true">▶</span> Run
        </button>
      )}
      <label className="sp-toggle" title="Re-run the script as you type">
        <input type="checkbox" checked={p.autoRun} onChange={(e) => p.setAutoRun(e.target.checked)} />
        <span>Auto-run</span>
      </label>
      <div className="sp-spacer" />
      <ExamplesMenu />
      <button className="sp-btn ghost" onClick={p.openClips} title="Import a video as a clip you can play with clip(name)">
        <FilmIcon />
        <span className="sp-btn-label">Clips{clipCount ? ` · ${clipCount}` : ''}</span>
      </button>
      <button
        className={`sp-btn ghost${p.docsOpen ? ' on' : ''}`}
        onClick={p.toggleDocs}
        aria-pressed={p.docsOpen}
        title="Scripting reference: every function, with examples"
      >
        <BookIcon />
        <span className="sp-btn-label">Reference</span>
      </button>
    </div>
  );
}

const stopScript = () => useScriptRuntime.getState().requestStop();

function ExamplesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadGraph = useStore((s) => s.loadGraph);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className="sp-menu" ref={ref}>
      <button className="sp-btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Open an example script">
        <span className="sp-btn-label">Examples</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sp-menu-pop" role="menu">
          {DEMOS.map((d) => (
            <button
              key={d.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                const g = d.build();
                const prev = useStore.getState().script?.code ?? '';
                registerAssets(g.assets);
                loadGraph(g);
                useScriptRuntime.setState({ time: 0, playing: true, replaced: prev.trim() && prev !== g.script?.code ? prev : null });
              }}
            >
              <span className="sp-menu-title">{d.title}</span>
              <span className="sp-menu-blurb">{d.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplacedBanner({ previous }: { previous: string }) {
  const setCode = useStore((s) => s.setScriptCode);
  return (
    <div className="sp-banner" role="status">
      <span>Your previous script was replaced.</span>
      <button
        onClick={() => {
          setCode(previous);
          useScriptRuntime.setState({ replaced: null });
        }}
      >
        Restore it
      </button>
      <button className="dim" onClick={() => useScriptRuntime.setState({ replaced: null })} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

function Starters({ openDocs }: { openDocs: () => void }) {
  return (
    <div className="sp-starters">
      <div className="sp-starters-title">Script mode</div>
      <p>
        Write JavaScript that draws on the graph: shapes, colours, animation and sliders. It runs in a sandbox, and the
        canvas, pan and zoom stay shared with Graph mode.
      </p>
      <div className="sp-starters-row">
        {STARTERS.map((s) => (
          <button key={s.label} className="sp-chip" onClick={() => trySnippet(s.code)}>
            {s.label}
          </button>
        ))}
        <button className="sp-chip accent" onClick={openDocs}>
          Read the guide →
        </button>
      </div>
    </div>
  );
}

function Sliders() {
  const decls = useScriptRuntime((s) => s.frame?.sliders ?? EMPTY);
  const values = useStore((s) => s.script?.sliders);
  const set = useStore((s) => s.setScriptSlider);
  if (!decls.length) return null;
  return (
    <div className="sp-sliders" aria-label="Script sliders">
      {decls.map((d) => (
        <SliderRow key={d.name} d={d} value={values?.[d.name]} set={set} />
      ))}
    </div>
  );
}
const EMPTY: SliderDecl[] = [];

function SliderRow({ d, value, set }: { d: SliderDecl; value: number | undefined; set: (n: string, v: number) => void }) {
  const v = typeof value === 'number' ? Math.min(d.max, Math.max(d.min, value)) : d.value;
  const step = d.step || niceStep(d.max - d.min);
  return (
    <label className="sp-slider">
      <span className="sp-slider-name">{d.name}</span>
      <input
        className="range"
        type="range"
        min={d.min}
        max={d.max}
        step={step}
        value={v}
        onChange={(e) => set(d.name, Number(e.target.value))}
      />
      <span className="sp-slider-val">{fmt(v)}</span>
    </label>
  );
}

function niceStep(span: number) {
  return span > 0 ? Math.pow(10, Math.floor(Math.log10(span / 100))) : 0.01;
}
const fmt = (v: number) => String(+v.toPrecision(4));

function Clock() {
  const animated = useScriptRuntime((s) => !!s.frame?.animated);
  const loop = useScriptRuntime((s) => s.frame?.loop ?? null);
  const time = useScriptRuntime((s) => s.time);
  const playing = useScriptRuntime((s) => s.playing);
  const killed = useScriptRuntime((s) => s.killed);
  const { setTime, setPlaying } = useScriptRuntime.getState();
  const max = useMemo(() => loop ?? Math.max(10, Math.ceil(time / 10) * 10), [loop, time]);
  if (!animated) return null;
  return (
    <div className="sp-clock" aria-label="Animation clock">
      <button
        className="sp-play"
        onClick={() => setPlaying(!playing)}
        disabled={killed}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="sp-play ghost" onClick={() => setTime(0)} title="Back to the start" aria-label="Back to the start">
        ⟲
      </button>
      <input
        className="range"
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={Math.min(time, max)}
        aria-label="Time"
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
      />
      <span className="sp-time">
        {time.toFixed(1)} s{loop ? ` / ${fmt(loop)}` : ''}
      </span>
    </div>
  );
}

function Console() {
  const error = useScriptRuntime((s) => s.error);
  const frame = useScriptRuntime((s) => s.frame);
  const status = useScriptRuntime((s) => s.status);
  const killed = useScriptRuntime((s) => s.killed);
  const lastMs = useScriptRuntime((s) => s.lastMs);
  const hasCode = useStore((s) => !!s.script?.code.trim());
  const [expanded, setExpanded] = useState(false);
  const logs = frame?.logs ?? [];
  const shapes = frame?.items.length ?? 0;

  let tone: 'ok' | 'error' | 'idle' = 'ok';
  let message: string;
  if (error) {
    tone = 'error';
    message = error.line ? `Line ${error.line}: ${error.message}` : error.message;
  } else if (!hasCode) {
    tone = 'idle';
    message = 'Empty script';
  } else if (status === 'starting' && !frame) {
    tone = 'idle';
    message = 'Starting the sandbox…';
  } else {
    message = `${shapes} shape${shapes === 1 ? '' : 's'} · ${lastMs < 1 ? '<1' : lastMs.toFixed(lastMs < 10 ? 1 : 0)} ms`;
  }

  return (
    <div className={`sp-console ${tone}${expanded ? ' expanded' : ''}`} role="status" aria-live="polite">
      <div className="sp-console-line">
        <span className={`sp-dot ${tone}`} aria-hidden="true" />
        {error?.line ? (
          <button className="sp-console-msg link" onClick={() => focusLine(error.line!)} title="Go to the line">
            {message}
          </button>
        ) : (
          <span className="sp-console-msg">{message}</span>
        )}
        {killed && <span className="sp-badge">stopped</span>}
        {lastMs > 40 && !error && <span className="sp-badge warn" title="Each frame takes long; the animation may stutter">slow</span>}
        {logs.length > 0 && (
          <button className="sp-console-toggle" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Hide' : 'Console'} · {logs.length}
          </button>
        )}
      </div>
      {expanded && logs.length > 0 && (
        <pre className="sp-logs">
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </pre>
      )}
    </div>
  );
}

function FilmIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 3v10M11 3v10M2 6.3h3M2 9.7h3M11 6.3h3M11 9.7h3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.2c2-.8 3.8-.6 5.5.6v9.2c-1.7-1.2-3.5-1.4-5.5-.6V3.2ZM13.5 3.2c-2-.8-3.8-.6-5.5.6v9.2c1.7-1.2 3.5-1.4 5.5-.6V3.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
