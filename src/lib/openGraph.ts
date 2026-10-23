// "Open this graph, and offer Undo" — a tiny channel so any part of the UI (the
// docs' "Try it" buttons, the Examples menu) can replace the current graph through
// the one place that knows how: GraphMenu, which registers assets, loads the
// graph and shows the toast with an Undo button restoring the previous graph.
import type { GraphData } from './graphFile';

type Handler = (graph: GraphData, title: string) => void;

let handler: Handler | null = null;

/** GraphMenu installs the handler on mount; returns an uninstaller. */
export function setOpenGraphHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** Replace the current graph with `graph`, showing "Opened “title”" + Undo.
 * Returns false when no handler is mounted (nothing happened). */
export function openGraphWithUndo(graph: GraphData, title: string): boolean {
  if (!handler) return false;
  handler(graph, title);
  return true;
}

// The plain "replace the graph" path (register assets, load, and whatever else
// GraphMenu.applyGraph does), without the toast — used by saved graphs (Graphs/),
// which shows its own toast and tracks which saved graph is open.
type Apply = (graph: GraphData) => void;
let applyHandler: Apply | null = null;

export function setApplyGraphHandler(h: Apply): () => void {
  applyHandler = h;
  return () => {
    if (applyHandler === h) applyHandler = null;
  };
}

/** Load `graph` through GraphMenu's apply path; returns false if it isn't mounted. */
export function applyGraphDirect(graph: GraphData): boolean {
  if (!applyHandler) return false;
  applyHandler(graph);
  return true;
}

// Hook run before any graph replaces the current one (examples, imports, links,
// docs "Try it", saved graphs): saved graphs files the outgoing work in Recent
// and detaches it from the saved graph it was editing.
let beforeReplace: (() => void) | null = null;

export function setBeforeGraphReplace(h: (() => void) | null): void {
  beforeReplace = h;
}

export function notifyBeforeGraphReplace(): void {
  beforeReplace?.();
}
