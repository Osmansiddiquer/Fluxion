import { DEMOS } from '../demos';
import { graphToSpec, type FluxionSpec } from './spec';
import { DEFAULT_BASE_URL } from './url';

/**
 * The built-in demos, exposed to agents: each opens with `#example=<id>`, and
 * every demo that doesn't carry an imported clip is also published as an
 * editable JSON spec at `examples/<id>.json` — a template to adapt.
 */

export interface ExampleInfo {
  id: string;
  title: string;
  blurb: string;
  /** Link that opens the demo as-is. */
  link: string;
  /** Path of its JSON spec (relative to the app), if it can be one. */
  spec?: string;
}

/** The demo as a JSON spec, or null if it doesn't exist or carries a frame clip
 * (clips travel only in graph files / `#g=` links, not in specs). */
export function exampleSpec(id: string): FluxionSpec | null {
  const demo = DEMOS.find((d) => d.id === id);
  if (!demo) return null;
  const g = demo.build();
  if (g.assets || g.entries.some((e) => e.frames)) return null;
  return graphToSpec(g);
}

export function listExamples(base: string = DEFAULT_BASE_URL): ExampleInfo[] {
  const root = base.replace(/#.*$/, '');
  return DEMOS.map((d) => ({
    id: d.id,
    title: d.title,
    blurb: d.blurb,
    link: `${root}#example=${d.id}`,
    ...(exampleSpec(d.id) ? { spec: `examples/${d.id}.json` } : {}),
  }));
}
