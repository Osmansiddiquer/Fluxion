import { useStore } from '../store/useStore';

/** Draggable divider that resizes the sidebar (width persisted in the store). */
export default function Resizer() {
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setSidebarWidth(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return <div className="resizer" onPointerDown={onPointerDown} title="Drag to resize" />;
}
