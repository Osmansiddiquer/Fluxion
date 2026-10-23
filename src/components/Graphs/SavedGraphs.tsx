import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closeSheet,
  copyLink,
  deleteRecent,
  deleteSaved,
  dismissToast,
  duplicateSaved,
  exportGraph,
  initSaved,
  keepRecent,
  loadLatest,
  newGraph,
  openRecent,
  openSaved,
  quickSave,
  renameCurrent,
  renameSaved,
  resolveConflict,
  saveCurrent,
  useSaved,
} from '../../state/savedGraphs';
import { docStatus, matchesQuery, relativeTime, STATUS_TEXT } from '../../lib/saved/session';
import type { RecentGraph, SavedGraph } from '../../lib/saved/library';
import { thumbnailOfPlot } from '../../lib/saved/thumbnail';
import { CopyIcon, GraphGlyph, MoreIcon, PlusIcon, SaveIcon, SearchIcon } from './icons';
import './Graphs.css';

/**
 * Saved graphs UI root (mounted once in App): wires the library up, owns the
 * Ctrl/Cmd+S shortcut, and renders the "My graphs" sheet, its toast (with Undo)
 * and the cross-tab conflict prompt.
 */
export default function SavedGraphs() {
  const sheet = useSaved((s) => s.sheet);
  useEffect(() => {
    void initSaved();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        quickSave();
      }
    };
    // Capture phase: MathLive fields would otherwise see the key first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <>
      {sheet && <Sheet focusName={!!sheet.focusName} />}
      <Toast />
      <ConflictPrompt />
    </>
  );
}

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function Sheet({ focusName }: { focusName: boolean }) {
  const list = useSaved((s) => s.list);
  const recent = useSaved((s) => s.recent);
  const storageKind = useSaved((s) => s.storageKind);
  const ready = useSaved((s) => s.ready);
  const [q, setQ] = useState('');
  const now = useNow();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    if (!focusName) panelRef.current?.querySelector<HTMLElement>('.graphs-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.graphs-item-menu')) closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [focusName]);

  const shownSaved = useMemo(() => list.filter((r) => matchesQuery(r.name, q)), [list, q]);
  const shownRecent = useMemo(() => recent.filter((r) => matchesQuery(r.label, q)), [recent, q]);
  const searchable = list.length + recent.length > 5;

  return (
    <div className="graphs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="graphs-sheet" role="dialog" aria-modal="true" aria-labelledby="graphs-title" ref={panelRef}>
        <div className="graphs-head">
          <h2 id="graphs-title">My graphs</h2>
          <button className="graphs-close icon-btn" onClick={closeSheet} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </div>
        <CurrentCard focusName={focusName} />
        {storageKind === 'memory' && (
          <p className="graphs-note warn" role="note">
            This browser isn’t letting Fluxion store data (private mode?), so saved graphs last only until this tab
            closes. Use <b>Export to file</b> to keep one.
          </p>
        )}
        {searchable && (
          <label className="graphs-search">
            {SearchIcon}
            <input
              type="search"
              placeholder="Search graphs"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search graphs"
            />
          </label>
        )}
        <div className="graphs-scroll">
          <section aria-labelledby="graphs-saved-h">
            <h3 id="graphs-saved-h">
              Saved <span className="graphs-count">{list.length || ''}</span>
            </h3>
            {!ready ? (
              <p className="graphs-empty">Loading…</p>
            ) : shownSaved.length ? (
              <ul className="graphs-list">
                {shownSaved.map((r) => (
                  <SavedItem key={r.id} rec={r} now={now} />
                ))}
              </ul>
            ) : (
              <p className="graphs-empty">
                {q ? 'No saved graphs match.' : 'Nothing saved yet. Name this graph above and press Save.'}
              </p>
            )}
          </section>
          {(shownRecent.length > 0 || (!q && recent.length > 0)) && (
            <section aria-labelledby="graphs-recent-h">
              <h3 id="graphs-recent-h">
                Recent <span className="graphs-sub">unsaved work, kept automatically</span>
              </h3>
              {shownRecent.length ? (
                <ul className="graphs-list">
                  {shownRecent.map((r) => (
                    <RecentItem key={r.id} rec={r} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="graphs-empty">No recent work matches.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** The graph open in this tab: its name (editable), status, Save / Save as copy / New. */
function CurrentCard({ focusName }: { focusName: boolean }) {
  const docId = useSaved((s) => s.docId);
  const name = useSaved((s) => s.name);
  const dirty = useSaved((s) => s.dirty);
  const remote = useSaved((s) => s.remote);
  const busy = useSaved((s) => s.busy);
  const status = docStatus({ docId, name }, dirty, remote);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [thumb] = useState(() => thumbnailOfPlot());
  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    if (focusName) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusName]);

  const cancelled = useRef(false);
  const commitName = () => {
    if (cancelled.current) return;
    if (draft.trim() && draft.trim() !== name) void renameCurrent(draft);
    else setDraft(name);
  };
  // Enter in the name box saves and closes (the Ctrl+S "name it" flow); the button keeps the sheet open.
  const save = async (close = false) => {
    const n = draft.trim();
    cancelled.current = true; // the save carries the name; don't also rename on blur
    const ok = await saveCurrent({ name: n && n !== name ? n : undefined });
    cancelled.current = false;
    if (ok && close) closeSheet();
  };

  return (
    <div className={`graphs-current status-${status}`}>
      <Thumb src={thumb} />
      <div className="graphs-current-body">
        <div className="graphs-current-top">
          <input
            ref={inputRef}
            className="graphs-name-input"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save(true);
              } else if (e.key === 'Escape') {
                // Discard the edit; the sheet's own Esc handler then closes it.
                cancelled.current = true;
              }
            }}
            aria-label="Graph name"
            spellCheck={false}
          />
          <span className="graphs-status">
            <span className="graphs-dot" aria-hidden="true" />
            {STATUS_TEXT[status]}
          </span>
        </div>
        {(remote === 'changed' || remote === 'deleted') && (
          <p className="graphs-note warn">
            {remote === 'changed'
              ? 'Another tab saved a newer version of this graph. Saving here will ask before overwriting it.'
              : 'Another tab deleted this graph. Save to keep it, or save a copy.'}
            {remote === 'changed' && (
              <button className="graphs-link" onClick={() => void loadLatest()}>
                Load latest
              </button>
            )}
          </p>
        )}
        <div className="graphs-actions">
          <button className="graphs-btn primary" onClick={() => void save()} disabled={busy || (!!docId && !dirty && !remote)}>
            {SaveIcon}
            {docId ? (dirty || remote ? 'Save' : 'Saved') : 'Save'}
          </button>
          {docId && (
            <button className="graphs-btn" onClick={() => void saveCurrent({ asCopy: true })} disabled={busy}>
              {CopyIcon}
              Save as copy
            </button>
          )}
          <button className="graphs-btn" onClick={() => void newGraph()} title="Start a blank graph; this one stays in My graphs / Recent">
            {PlusIcon}
            New graph
          </button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ src }: { src?: string }) {
  return <span className="graphs-thumb">{src ? <img src={src} alt="" loading="lazy" /> : GraphGlyph}</span>;
}

interface MenuAction {
  label: string;
  run: () => void;
  danger?: boolean;
}

function ItemMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLElement>('.graphs-more')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('.graphs-item-menu button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className="graphs-more-wrap" ref={ref}>
      <button
        className="graphs-more icon-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {MoreIcon}
      </button>
      {open && (
        <div className="graphs-item-menu" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              className={a.danger ? 'danger' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedItem({ rec, now }: { rec: SavedGraph; now: number }) {
  const openHere = useSaved((s) => s.docId === rec.id);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(rec.name);
  const commit = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== rec.name) void renameSaved(rec.id, draft);
  };
  return (
    <li className={openHere ? 'graphs-item current' : 'graphs-item'}>
      <button
        className="graphs-item-main"
        onClick={() => !renaming && void openSaved(rec.id)}
        title={openHere ? 'Open in this tab (reloads the saved version)' : `Open “${rec.name}”`}
        tabIndex={renaming ? -1 : 0}
      >
        <Thumb src={rec.thumb} />
        <span className="graphs-item-text">
          {renaming ? (
            <input
              className="graphs-rename"
              value={draft}
              autoFocus
              maxLength={120}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setDraft(rec.name);
                  setRenaming(false);
                }
              }}
              aria-label="New name"
            />
          ) : (
            <span className="graphs-item-name">{rec.name}</span>
          )}
          <span className="graphs-item-meta">
            {openHere && <span className="graphs-pill">Open here</span>}
            Edited {relativeTime(rec.updatedAt, now)}
          </span>
        </span>
      </button>
      <ItemMenu
        actions={[
          { label: 'Open', run: () => void openSaved(rec.id) },
          {
            label: 'Rename',
            run: () => {
              setDraft(rec.name);
              setRenaming(true);
            },
          },
          { label: 'Duplicate', run: () => void duplicateSaved(rec.id) },
          { label: 'Copy share link', run: () => void copyLink('saved', rec.id) },
          { label: 'Export to file…', run: () => void exportGraph('saved', rec.id) },
          { label: 'Delete', run: () => void deleteSaved(rec.id), danger: true },
        ]}
      />
    </li>
  );
}

function RecentItem({ rec, now }: { rec: RecentGraph; now: number }) {
  return (
    <li className="graphs-item recent">
      <button className="graphs-item-main" onClick={() => void openRecent(rec.id)} title="Open this work">
        <Thumb src={rec.thumb} />
        <span className="graphs-item-text">
          <span className="graphs-item-name mono">{rec.label}</span>
          <span className="graphs-item-meta">Autosaved {relativeTime(rec.updatedAt, now)}</span>
        </span>
      </button>
      <button className="graphs-keep" onClick={() => void keepRecent(rec.id)} title="Save it to My graphs">
        Keep
      </button>
      <ItemMenu
        actions={[
          { label: 'Open', run: () => void openRecent(rec.id) },
          { label: 'Save to My graphs', run: () => void keepRecent(rec.id) },
          { label: 'Copy share link', run: () => void copyLink('recent', rec.id) },
          { label: 'Export to file…', run: () => void exportGraph('recent', rec.id) },
          { label: 'Remove', run: () => void deleteRecent(rec.id), danger: true },
        ]}
      />
    </li>
  );
}

function Toast() {
  const toast = useSaved((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={toast.error ? 'graph-toast error graphs-toast' : 'graph-toast graphs-toast'} role={toast.error ? 'alert' : 'status'}>
      {toast.msg}
      {toast.undo && (
        <button
          className="graph-toast-undo"
          onClick={() => {
            const u = toast.undo!;
            dismissToast();
            u();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

function ConflictPrompt() {
  const conflict = useSaved((s) => s.conflict);
  const name = useSaved((s) => s.name);
  const now = useNow();
  if (!conflict) return null;
  const when = conflict.current ? relativeTime(conflict.current.updatedAt, now) : '';
  return (
    <div className="graphs-conflict" role="alertdialog" aria-labelledby="graphs-conflict-t">
      <p id="graphs-conflict-t">
        {conflict.reason === 'deleted' ? (
          <>
            <b>“{name}”</b> was deleted in another tab.
          </>
        ) : (
          <>
            <b>“{name}”</b> was changed in another tab ({when}). Saving here would overwrite that version.
          </>
        )}
      </p>
      <div className="graphs-conflict-actions">
        <button className="graphs-btn primary" onClick={() => void resolveConflict.saveCopy()}>
          Save as copy
        </button>
        <button className="graphs-btn" onClick={() => void resolveConflict.overwrite()}>
          {conflict.reason === 'deleted' ? 'Save anyway' : 'Overwrite'}
        </button>
        {conflict.reason === 'changed' && (
          <button className="graphs-btn" onClick={() => void resolveConflict.openTheirs()} title="Your current work stays in Recent">
            Open theirs
          </button>
        )}
        <button className="graphs-btn ghost" onClick={resolveConflict.cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
