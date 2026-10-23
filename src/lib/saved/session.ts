/**
 * Pure helpers for a tab's link to the saved graph it's editing (the "doc"):
 * status for the header indicator, and how to react to another tab's change.
 * Kept free of React / the DOM so they're unit-tested in node.
 */
import type { LibraryMessage } from './channel';

export interface DocLink {
  /** The saved graph this tab is editing, or null for an unsaved ("Untitled") graph. */
  docId: string | null;
  name: string;
  /** The saved graph's rev this tab last opened / saved. */
  baseRev?: number;
  /** graphHash of the content as last opened / saved. */
  savedHash?: string;
}

export type RemoteState = null | 'changed' | 'deleted';

export type DocStatus = 'saved' | 'unsaved' | 'new' | 'conflict' | 'deleted';

/** What the header indicator should say. */
export function docStatus(link: DocLink, dirty: boolean, remote: RemoteState): DocStatus {
  if (!link.docId) return 'new';
  if (remote === 'deleted') return 'deleted';
  if (remote === 'changed') return 'conflict';
  return dirty ? 'unsaved' : 'saved';
}

export const STATUS_TEXT: Record<DocStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  new: 'Not saved',
  conflict: 'Changed in another tab',
  deleted: 'Deleted in another tab',
};

/**
 * How a message from another tab affects this tab's doc. Returns the new
 * remote state and (on a rename) the new name; undefined fields = unchanged.
 */
export function applyRemote(
  link: DocLink,
  remote: RemoteState,
  msg: LibraryMessage,
  me: string,
): { remote?: RemoteState; name?: string } {
  if (msg.from === me || !link.docId || msg.id !== link.docId) return {};
  if (msg.type === 'deleted') return { remote: 'deleted' };
  if (msg.type === 'saved') {
    // A save that brought it back (Undo of a delete re-saves the same rev) clears 'deleted'.
    if (msg.rev !== undefined && msg.rev === link.baseRev) return { remote: remote === 'deleted' ? null : remote };
    return { remote: 'changed' };
  }
  return {};
}

/** "just now", "5 min ago", "yesterday", "12 Mar" — for list items. */
export function relativeTime(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Case-insensitive match on name / label (search box). */
export function matchesQuery(text: string, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return n.split(/\s+/).every((w) => text.toLowerCase().includes(w));
}

/** A file name for an exported graph. */
export function fileNameFor(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'fluxion-graph'}.json`;
}
