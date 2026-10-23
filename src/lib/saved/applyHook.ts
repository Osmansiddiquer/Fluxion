// Hooks between GraphMenu (the one place that knows how to load a graph) and
// saved graphs (state/savedGraphs.ts).
import type { GraphData } from '../graphFile';

// The plain "replace the graph" path (register assets, load, and whatever else
// GraphMenu.applyGraph does), without the toast — used by saved graphs,
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
