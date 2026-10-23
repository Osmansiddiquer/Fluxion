import { useStore } from '../../store/useStore';
import { useScriptRuntime } from '../../state/scriptRuntime';

/**
 * In Graph mode, a graph that also has a script says so: a small chip on the
 * canvas to show / hide the script's drawing or jump to the editor.
 */
export default function ScriptChip() {
  const mode = useStore((s) => s.mode ?? 'graph');
  const has = useStore((s) => !!s.script?.code.trim());
  const visible = useStore((s) => s.script?.visible !== false);
  const setVisible = useStore((s) => s.setScriptVisible);
  const setMode = useStore((s) => s.setMode);
  const error = useScriptRuntime((s) => !!s.error);
  if (mode !== 'graph' || !has) return null;
  return (
    <div className="script-chip" role="group" aria-label="Script layer">
      <span className={`script-chip-dot${error ? ' err' : ''}`} aria-hidden="true" />
      <span className="script-chip-label">Script layer</span>
      <button
        className="script-chip-btn"
        onClick={() => setVisible(!visible)}
        title={visible ? "Hide the script's drawing" : "Show the script's drawing"}
        aria-pressed={visible}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
      <button className="script-chip-btn primary" onClick={() => setMode('script')} title="Open the script editor">
        Edit
      </button>
    </div>
  );
}
