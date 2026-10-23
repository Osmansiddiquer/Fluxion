import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { makeGraph, encodeGraph, decodeGraph, parseGraphFile, type GraphData } from '../lib/graphFile';
import { registerAssets } from '../lib/frames/assets';
import { DEMOS } from '../lib/demos';

const ShareIcon = (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="13.5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4.5" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="13.5" cy="14" r="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.3 8 L11.7 5 M6.3 10 L11.7 13" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Share-link / export-to-file / import-from-file menu, and one-time import of a
 * graph encoded in the page URL (#g=…). */
export default function GraphMenu() {
  const loadGraph = useStore((s) => s.loadGraph);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Import a graph carried in the URL fragment, then strip it from the address bar.
  useEffect(() => {
    const m = location.hash.match(/^#g=(.+)$/);
    if (!m) return;
    const g = decodeGraph(m[1]);
    if (g) {
      registerAssets(g.assets);
      loadGraph(g);
    }
    history.replaceState(null, '', location.pathname + location.search);
  }, [loadGraph]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // A toast may carry an Undo (restores the graph an example replaced).
  const [undo, setUndo] = useState<GraphData | null>(null);
  const toastTimer = useRef(0);
  const flash = (msg: string, restore: GraphData | null = null, ms = 2200) => {
    setToast(msg);
    setUndo(restore);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast('');
      setUndo(null);
    }, ms);
  };

  const openDemo = (id: string) => {
    setOpen(false);
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    const prev = current();
    const g = demo.build();
    registerAssets(g.assets);
    loadGraph(g);
    flash(`Opened “${demo.title}”`, prev, 6000);
  };

  const current = () => makeGraph(useStore.getState());

  const share = async () => {
    setOpen(false);
    const url = `${location.origin}${location.pathname}#g=${encodeGraph(current())}`;
    try {
      await navigator.clipboard.writeText(url);
      flash('Share link copied to clipboard');
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
    const g = parseGraphFile(await f.text());
    if (g) {
      registerAssets(g.assets);
      loadGraph(g);
      flash('Graph loaded');
    } else {
      flash('That file is not a Fluxion graph');
    }
  };

  return (
    <div className="graph-menu" ref={rootRef}>
      <button
        className="icon-btn"
        title="Share / save graph"
        aria-label="Share or save graph"
        onClick={() => setOpen((o) => !o)}
      >
        {ShareIcon}
      </button>
      {open && (
        <div className="graph-menu-pop" role="menu">
          <button onClick={share}>Copy share link</button>
          <button onClick={exportFile}>Export to file…</button>
          <button onClick={() => fileRef.current?.click()}>Import from file…</button>
          <div className="graph-menu-sep" role="separator" />
          <div className="graph-menu-label">Examples</div>
          {DEMOS.map((d) => (
            <button key={d.id} className="graph-menu-demo" title={d.blurb} onClick={() => openDemo(d.id)}>
              {d.title}
            </button>
          ))}
        </div>
      )}
      {toast && (
        <div className="graph-toast" role="status">
          {toast}
          {undo && (
            <button
              className="graph-toast-undo"
              onClick={() => {
                registerAssets(undo.assets);
                loadGraph(undo);
                setToast('');
                setUndo(null);
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
