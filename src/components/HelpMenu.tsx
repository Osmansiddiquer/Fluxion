import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import './HelpMenu.css';

export interface HelpMenuHandle {
  /** Return keyboard focus to the ? button (after the tour / docs close). */
  focus: () => void;
}

/**
 * The header ? button: a small menu with "Take the tour" (the getting-started
 * carousel) and "Documentation" (the docs panel). Keyboard: Enter/Space/↓ opens
 * and focuses the first item, ↑/↓ move, Esc closes and returns focus.
 */
const HelpMenu = forwardRef<HelpMenuHandle, { onTour: () => void; onDocs: () => void }>(function HelpMenu(
  { onTour, onDocs },
  ref,
) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef(false);

  useImperativeHandle(ref, () => ({ focus: () => btnRef.current?.focus() }), []);

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) itemsRef.current[0]?.focus();
    focusOnOpen.current = false;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Esc anywhere closes the menu (the menu's own handler also restores focus).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="help-menu" ref={rootRef}>
      <button
        ref={btnRef}
        className="icon-btn"
        title="Help"
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (open) itemsRef.current[0]?.focus();
            else {
              focusOnOpen.current = true;
              setOpen(true);
            }
          } else if ((e.key === 'Enter' || e.key === ' ') && !open) {
            focusOnOpen.current = true;
          }
        }}
      >
        <HelpIcon />
      </button>
      {open && (
        <div className="help-menu-pop" role="menu" aria-label="Help" onKeyDown={onMenuKey}>
          <button ref={(el) => (itemsRef.current[0] = el)} role="menuitem" onClick={() => pick(onTour)}>
            <span className="help-menu-ico" aria-hidden="true">
              <TourIcon />
            </span>
            <span className="help-menu-text">
              <span className="help-menu-title">Take the tour</span>
              <span className="help-menu-sub">A one-minute introduction</span>
            </span>
          </button>
          <button ref={(el) => (itemsRef.current[1] = el)} role="menuitem" onClick={() => pick(onDocs)}>
            <span className="help-menu-ico" aria-hidden="true">
              <BookIcon />
            </span>
            <span className="help-menu-text">
              <span className="help-menu-title">Documentation</span>
              <span className="help-menu-sub">Every feature, with examples</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
});

export default HelpMenu;

function HelpIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.1 6.9a1.9 1.9 0 1 1 2.6 1.76c-.5.22-.7.6-.7 1.04v.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="12.7" r="0.85" fill="currentColor" />
    </svg>
  );
}

function TourIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5.5 4 L11.5 8 L5.5 12 Z" fill="currentColor" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 4.2C6.6 3.2 4.6 2.9 2.5 3.1v9.2c2.1-.2 4.1.1 5.5 1.1 1.4-1 3.4-1.3 5.5-1.1V3.1c-2.1-.2-4.1.1-5.5 1.1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 4.2v9.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
