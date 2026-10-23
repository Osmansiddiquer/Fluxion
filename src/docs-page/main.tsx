/// <reference types="vite/client" />
// Client entry of the docs page. In a build the page is already pre-rendered
// (with its Try-it links and TeX embedded as JSON), so this hydrates it. In dev
// the page is empty, so this computes the links and renders from scratch.
import { createRoot, hydrateRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import '../styles/theme.css';
import './docs-page.css';
import DocsPage from './DocsPage';
import { loadTexMap, setTexRenderer } from './tex';
import type { DocsData } from './prerender';

const root = document.getElementById('docs-root')!;
const embedded = document.getElementById('docs-data')?.textContent;

if (embedded && root.firstElementChild) {
  const data = JSON.parse(embedded) as DocsData;
  loadTexMap(data.tex);
  hydrateRoot(root, <DocsPage links={data.links} />);
} else if (import.meta.env.DEV) {
  // Dev only (dead code in a build, so neither the parser nor KaTeX's JS enters
  // the docs bundle): build the links and render TeX on the fly.
  Promise.all([import('./links'), import('katex')]).then(async ([{ tryLinks }, { default: katex }]) => {
    setTexRenderer((src, displayMode) => katex.renderToString(src, { throwOnError: false, displayMode }));
    createRoot(root).render(<DocsPage links={await tryLinks()} />);
    if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 50);
  });
} else {
  createRoot(root).render(<DocsPage links={{}} />);
}
