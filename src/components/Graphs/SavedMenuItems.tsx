import { newGraph, openSheet, quickSave, saveCurrent, useSaved } from '../../state/savedGraphs';
import { docStatus, STATUS_TEXT } from '../../lib/saved/session';
import { CopyIcon, FolderIcon, PlusIcon, SaveIcon } from './icons';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** The saved-graphs block at the top of the share / graph menu. */
export default function SavedMenuItems({ onPick }: { onPick: () => void }) {
  const name = useSaved((s) => s.name);
  const docId = useSaved((s) => s.docId);
  const dirty = useSaved((s) => s.dirty);
  const remote = useSaved((s) => s.remote);
  const status = docStatus({ docId, name }, dirty, remote);
  const pick = (fn: () => void) => () => {
    onPick();
    fn();
  };
  return (
    <>
      <div className={`graphs-menu-head status-${status}`}>
        <span className="graphs-menu-name">{name || 'Untitled graph'}</span>
        <span className="graphs-menu-status">
          <span className="graphs-dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </div>
      <button className="graphs-menu-item" onClick={pick(quickSave)}>
        {SaveIcon}
        <span>{docId ? 'Save' : 'Save…'}</span>
        <kbd>{MOD}S</kbd>
      </button>
      {docId && (
        <button className="graphs-menu-item" onClick={pick(() => void saveCurrent({ asCopy: true }))}>
          {CopyIcon}
          <span>Save as copy</span>
        </button>
      )}
      <button className="graphs-menu-item" onClick={pick(() => void newGraph())}>
        {PlusIcon}
        <span>New graph</span>
      </button>
      <button className="graphs-menu-item" onClick={pick(() => openSheet())}>
        {FolderIcon}
        <span>My graphs…</span>
      </button>
    </>
  );
}
