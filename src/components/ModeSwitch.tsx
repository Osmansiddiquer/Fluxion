import { useStore } from '../store/useStore';

/** Prefetch the Script mode chunk on intent (hover / focus) so the switch is instant. */
let prefetched = false;
export function prefetchScriptMode() {
  if (prefetched) return;
  prefetched = true;
  void import('./Script/ScriptPanel');
  void import('./Script/ScriptEngine');
}

/** "Graph | Script" segmented control in the header. */
export default function ModeSwitch() {
  const mode = useStore((s) => s.mode ?? 'graph');
  const setMode = useStore((s) => s.setMode);
  return (
    <div className="mode-seg" role="tablist" aria-label="Editor mode" onPointerEnter={prefetchScriptMode} onFocus={prefetchScriptMode}>
      <button
        role="tab"
        aria-selected={mode === 'graph'}
        className={`mode-seg-btn${mode === 'graph' ? ' active' : ''}`}
        onClick={() => setMode('graph')}
        title="Graph mode: type expressions and ODEs"
        aria-label="Graph mode"
      >
        <GraphGlyph />
        <span className="mode-seg-label">Graph</span>
      </button>
      <button
        role="tab"
        aria-selected={mode === 'script'}
        className={`mode-seg-btn${mode === 'script' ? ' active' : ''}`}
        onClick={() => setMode('script')}
        title="Script mode: draw and animate with JavaScript"
        aria-label="Script mode"
      >
        <CodeGlyph />
        <span className="mode-seg-label">Script</span>
      </button>
    </div>
  );
}

function GraphGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 13.5h12M2.5 13V2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.5 11c2.2-6 4-6.5 5.5-3.5s3 2.5 4.5-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CodeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
