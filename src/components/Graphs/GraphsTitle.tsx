import { useSaved, openSheet } from '../../state/savedGraphs';
import { docStatus, STATUS_TEXT } from '../../lib/saved/session';
import { FolderIcon } from './icons';
import './Graphs.css';

/**
 * Header indicator: the graph's name and whether it's saved. Click to open
 * "My graphs". Wide screens only (CSS hides it on phones, where the share menu
 * button carries an unsaved dot instead — see SavedDot).
 */
export default function GraphsTitle() {
  const name = useSaved((s) => s.name);
  const docId = useSaved((s) => s.docId);
  const dirty = useSaved((s) => s.dirty);
  const remote = useSaved((s) => s.remote);
  const status = docStatus({ docId, name }, dirty, remote);
  const label = name || 'Untitled graph';
  return (
    <button
      className={`graphs-title status-${status}`}
      onClick={() => openSheet()}
      title={`${STATUS_TEXT[status]}${status === 'new' && dirty ? ' (autosaved to Recent)' : ''} — open My graphs (Ctrl+S saves)`}
      aria-label={`${label}, ${STATUS_TEXT[status]}. Open My graphs`}
    >
      <span className="graphs-title-ico">{FolderIcon}</span>
      <span className="graphs-title-name">{label}</span>
      <span className="graphs-title-status">
        <span className="graphs-dot" aria-hidden="true" />
        <span className="graphs-title-status-text">{STATUS_TEXT[status]}</span>
      </span>
    </button>
  );
}

/** A small dot on the share/graph menu button while there are unsaved changes. */
export function SavedDot() {
  const docId = useSaved((s) => s.docId);
  const dirty = useSaved((s) => s.dirty);
  const remote = useSaved((s) => s.remote);
  const status = docStatus({ docId, name: '' }, dirty, remote);
  if (status === 'saved' || (status === 'new' && !dirty)) return null;
  return <span className={`graphs-btn-dot status-${status}`} aria-hidden="true" />;
}
