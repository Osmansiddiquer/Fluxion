// Build-time pre-render of the docs page: React → static HTML (renderToString),
// injected into the Vite-built template with the head tags and the hydration data
// (Try-it links + pre-rendered TeX). Pure functions, unit-tested in
// docs-page.test.ts and driven by scripts/prerender-docs.ts after
// `vite build --config vite.docs.config.mjs`.
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import katex from 'katex';
import DocsPage from './DocsPage';
import { setTexRenderer, texMap } from './tex';

setTexRenderer((src, displayMode) => katex.renderToString(src, { throwOnError: false, displayMode }));

/** What the client needs to hydrate: Try links and the pre-rendered TeX. */
export interface DocsData {
  links: Record<string, string>;
  tex: Record<string, string>;
}

export const SITE = 'https://osmansiddiquer.github.io/Fluxion/';

/** The static HTML of the page body, and the data to hydrate it with. */
export function renderDocs(links: Record<string, string>): { body: string; data: DocsData } {
  const body = renderToString(createElement(DocsPage, { links }));
  return { body, data: { links, tex: texMap() } };
}

/** Head tags added at build time (relative to dist/docs/index.html). */
export const HEAD_TAGS = [
  `<link rel="canonical" href="${SITE}docs/" />`,
  '<link rel="icon" href="../favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="../favicon-32.png" sizes="32x32" type="image/png" />',
  '<link rel="apple-touch-icon" href="../apple-touch-icon.png" />',
  '<link rel="alternate" type="text/plain" href="../llms.txt" title="Fluxion for LLM agents (llms.txt)" />',
  '<link rel="help" type="text/plain" href="../llms.txt" title="Fluxion URL API for LLM agents" />',
  '<meta property="og:type" content="website" />',
  '<meta property="og:title" content="Fluxion documentation" />',
  `<meta property="og:url" content="${SITE}docs/" />`,
  `<meta property="og:image" content="${SITE}og.png" />`,
].join('\n    ');

/** JSON for a <script> element: `<` escaped so content can't close the tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Fill the built template: body HTML, head tags and the hydration data. The Vite
 * build emits the page at dist/docs/src/docs-page/index.html (it mirrors the
 * source path); it is moved to dist/docs/index.html, so its relative asset URLs
 * (`../../assets/…`) become `./assets/…`.
 */
export function injectDocs(template: string, body: string, data: DocsData): string {
  for (const marker of ['<!--docs-head-->', '<!--docs-body-->', '<!--docs-data-->']) {
    if (!template.includes(marker)) throw new Error(`docs template is missing ${marker}`);
  }
  return template
    .replace(/(["'(])\.\.\/\.\.\/assets\//g, '$1./assets/')
    .replace('<!--docs-head-->', HEAD_TAGS)
    .replace('<!--docs-body-->', () => body)
    .replace('<!--docs-data-->', () => `<script id="docs-data" type="application/json">${scriptJson(data)}</script>`);
}
