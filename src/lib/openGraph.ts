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
