import { useStore } from '../store/useStore';
import { DOCS_SIDE_MIN, DOCS_W } from './Script/layout';

/** Draggable divider that resizes the sidebar (width persisted in the store). */
export default function Resizer() {
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setScriptPanelWidth = useStore((s) => s.setScriptPanelWidth);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    // Script mode sizes its own (wider) panel; the docs column is extra.
    const move = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (s.mode === 'script') setScriptPanelWidth(ev.clientX - (s.scriptDocsOpen && window.innerWidth >= DOCS_SIDE_MIN ? DOCS_W : 0));
      else setSidebarWidth(ev.clientX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return <div className="resizer" onPointerDown={onPointerDown} title="Drag to resize" />;
}
