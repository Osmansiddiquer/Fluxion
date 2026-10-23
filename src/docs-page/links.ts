// "Try it" links for every docs example: plain links into the app built with the
// URL API (compressed `#z=` JSON spec, or `#example=<id>` for built-in demos).
// Generated at build time (scripts/prerender-docs.ts) and embedded in the page,
// so they work without JavaScript. Imports the spec/link code (and so the
// parser), so the docs client only loads this lazily, in dev.
import { allExamples } from '../components/Docs/content';
import { exampleGraph, type DocExample } from '../components/Docs/examples';
import { graphToSpec } from '../lib/api/spec';
import { buildLink } from '../lib/api/url';

/** The app, relative to the docs page (dist/docs/ → dist/). */
export const APP_BASE = '../';

export async function tryLink(ex: DocExample, base = APP_BASE): Promise<string> {
  if (ex.demo) return `${base}#example=${encodeURIComponent(ex.demo)}`;
  return buildLink(graphToSpec(exampleGraph(ex)), { base, format: 'z' });
}

/** Example id → link, for every example and syntax row in the docs. */
export async function tryLinks(base = APP_BASE): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const { example } of allExamples()) out[example.id] = await tryLink(example, base);
  return out;
}
