import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { makeGraph, parseGraphFile, type GraphData } from '../lib/graphFile';
import { loadFromUrl, sanitizeGraph } from '../lib/api/load';
import { buildShareLink, stripApiParams } from '../lib/api/url';
import { graphToSpec, specToGraph, validateSpec } from '../lib/api/spec';
import { registerAssets } from '../lib/frames/assets';
import { DEMOS } from '../lib/demos';
import { setOpenGraphHandler } from '../lib/openGraph';
import { useScriptRuntime } from '../state/scriptRuntime';
import { notifyBeforeGraphReplace, setApplyGraphHandler } from '../lib/saved/applyHook';
import SavedMenuItems from './Graphs/SavedMenuItems';
import { SavedDot } from './Graphs/GraphsTitle';

const isPlainSpecLike = (x: unknown) => !!x && typeof x === 'object' && 'expressions' in x;

const ShareIcon = (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="13.5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="13.5" cy="14" r="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.3 8 L11.7 5 M6.3 10 L11.7 13" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

interface Toast {
  msg: string;
  error?: boolean;
  /** The graph an example replaced — offered back via an Undo button. */
  undo?: GraphData;
}

/** Share-link / export-to-file / import-from-file menu, examples, and one-time
 * import of a graph carried by the page URL — a legacy share link (#g=…) or the
 * agent-facing URL API (#expr=…, #spec=…, #z=…; see lib/api and public/llms.txt). */
export default function GraphMenu() {
  const loadGraph = useStore((s) => s.loadGraph);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Every load path goes through here: frame-sequence assets must be registered
  // before the entries that reference them are computed.
  // A graph that carries a script opens in Script mode, with a fresh clock.
  const applyGraph = (g: GraphData): boolean => {
    notifyBeforeGraphReplace(); // saved graphs: file the outgoing work in Recent
    registerAssets(g.assets);
    loadGraph(g);
    useScriptRuntime.setState({ frame: null, error: null, killed: false, time: 0, playing: true, replaced: null });
    const scripted = !!g.script?.code.trim();
    // Show what was opened: its script, or its expressions.
    useStore.getState().setMode(scripted ? 'script' : 'graph');
    return scripted;
  };
  const applyRef = useRef(applyGraph);
  applyRef.current = applyGraph;

  const toastTimer = useRef(0);
  const flash = (msg: string, error = false, undo?: GraphData) => {
    setToast({ msg, error, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), error || undo ? 6000 : 2200);
  };
  const flashRef = useRef(flash);
  flashRef.current = flash;

  // Import a graph carried in the URL, then strip it from the address bar — on
  // load, and when a link is pasted into an already-open tab (only the hash
  // changes, so there's no reload). Only the live effect run applies it
  // (StrictMode mounts effects twice in dev).
  useEffect(() => {
    let live = true;
    const importFromUrl = () => {
      const { hash, search, pathname } = location;
      loadFromUrl(hash, search).then((r) => {
        if (!r) return;
        if (live) {
          const scripted = r.graph ? applyRef.current(r.graph) : false;
          if (r.message) flashRef.current(r.message, r.tone === 'error');
          else if (scripted) flashRef.current('This graph includes a script. It runs sandboxed: it can draw, nothing else.');
        }
        history.replaceState(null, '', pathname + stripApiParams(search));
      });
    };
    importFromUrl();
    window.addEventListener('hashchange', importFromUrl);
    return () => {
      live = false;
      window.removeEventListener('hashchange', importFromUrl);
    };
  }, [loadGraph]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = () => makeGraph(useStore.getState());

  // Replace the graph, keeping the old one for the toast's Undo. Shared with
  // Script mode's Examples menu via lib/openGraph.
  const openWithUndo = (g: GraphData, title: string) => {
    const prev = current();
    applyGraph(g);
    flash(`Opened “${title}”`, false, prev);
  };
  const openWithUndoRef = useRef(openWithUndo);
  openWithUndoRef.current = openWithUndo;
  useEffect(() => setOpenGraphHandler((g, title) => openWithUndoRef.current(g, title)), []);
  // Saved graphs loads through applyGraph too (see lib/saved/applyHook).
  useEffect(() => setApplyGraphHandler((g) => applyRef.current(g)), []);

  const openDemo = (id: string) => {
    setOpen(false);
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    openWithUndo(demo.build(), demo.title);
  };

  const share = async () => {
    setOpen(false);
    const link = buildShareLink(current(), `${location.origin}${location.pathname}`);
    try {
      // The link is built asynchronously (compression). Hand the clipboard a
      // pending item so Safari keeps the click's user activation; fall back to
      // writeText where ClipboardItem promises aren't supported.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const blob = link.then((url) => new Blob([url], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else {
        await navigator.clipboard.writeText(await link);
      }
      flash('Share link copied to clipboard');
    } catch {
      flash('Could not copy — clipboard blocked');
    }
  };

  // A readable FluxionSpec of the current graph — paste it to an AI assistant to
  // have it edit the graph and hand back a link.
  const copySpec = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(JSON.stringify(graphToSpec(current()), null, 2));
      flash('Graph JSON copied to clipboard');
    } catch {
      flash('Could not copy — clipboard blocked');
    }
  };

  const exportFile = () => {
    setOpen(false);
    const blob = new Blob([JSON.stringify(current(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fluxion-graph.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    const g = parseGraphFile(text);
    if (g) {
      applyGraph(sanitizeGraph(g));
      flash('Graph loaded');
      return;
    }
    // Also accept a FluxionSpec JSON file (what "Copy as JSON spec" produces).
    let spec: unknown;
    try {
      spec = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const v = spec === undefined ? null : validateSpec(spec);
    if (v?.ok) {
      applyGraph(specToGraph(v.spec));
      flash('Graph loaded');
    } else if (v && !v.ok && isPlainSpecLike(spec)) {
      const e = v.errors[0];
      flash(`Invalid graph spec — ${e.path ? e.path + ': ' : ''}${e.message}`, true);
    } else {
      flash('That file is not a Fluxion graph', true);
    }
  };

  return (
    <div className="graph-menu" ref={rootRef}>
      <button
        className="icon-btn"
        title="Save / share graph"
        aria-label="Save or share graph"
        onClick={() => setOpen((o) => !o)}
      >
        {ShareIcon}
        <SavedDot />
      </button>
      {open && (
        <div className="graph-menu-pop" role="menu">
          <SavedMenuItems onPick={() => setOpen(false)} />
          <div className="graph-menu-sep" role="separator" />
          <button onClick={share}>Copy share link</button>
          <button onClick={copySpec} title="A readable spec an AI assistant can edit (see llms.txt)">
            Copy as JSON spec
          </button>
          <button onClick={exportFile}>Export to file…</button>
          <button onClick={() => fileRef.current?.click()}>Import from file…</button>
          <div className="graph-menu-sep" role="separator" />
          <ExamplesSubmenu onPick={openDemo} />
        </div>
      )}
      {toast && (
        <div className={toast.error ? 'graph-toast error' : 'graph-toast'} role={toast.error ? 'alert' : 'status'}>
          {toast.msg}
          {toast.undo && (
            <button
              className="graph-toast-undo"
              onClick={() => {
                applyGraph(toast.undo!);
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onFile}
      />
    </div>
  );
}

/** "Examples ›": the demos in a flyout (inline on narrow screens). Hover opens it
 * with a mouse; a tap or click toggles it. */
function ExamplesSubmenu({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  // Closing waits a moment so the pointer can cross the gap to the flyout.
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const mouse = (e: React.PointerEvent) => e.pointerType === 'mouse';
  return (
    <div
      className="graph-menu-sub"
      onPointerEnter={(e) => {
        if (!mouse(e)) return;
        clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (mouse(e)) closeTimer.current = setTimeout(() => setOpen(false), 250);
      }}
    >
      <button
        className={`graph-menu-subtrigger${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setOpen(true);
        }}
      >
        <span>Examples</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="graph-menu-subpop" role="menu" aria-label="Examples">
          {DEMOS.map((d) => (
            <button key={d.id} role="menuitem" className="graph-menu-demo" title={d.blurb} onClick={() => onPick(d.id)}>
              {d.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
