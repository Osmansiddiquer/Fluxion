/**
 * Pre-render the docs page (run by `npm run build`, after the docs Vite build):
 *
 *   dist/docs/src/docs-page/index.html  (Vite output, empty #docs-root)
 *     → dist/docs/index.html            (static HTML + head tags + hydration data)
 *
 * The Try-it links are built here with the URL API, so they work without JS.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectDocs, renderDocs } from '../src/docs-page/prerender';
import { tryLinks } from '../src/docs-page/links';

const out = 'dist/docs';
const built = join(out, 'src/docs-page/index.html');
if (!existsSync(built)) {
  console.error(`prerender-docs: ${built} not found (run the docs Vite build first)`);
  process.exit(1);
}

const links = await tryLinks();
const { body, data } = renderDocs(links);
const html = injectDocs(readFileSync(built, 'utf8'), body, data);
writeFileSync(join(out, 'index.html'), html);
rmSync(join(out, 'src'), { recursive: true, force: true });
console.log(`prerender-docs: wrote ${join(out, 'index.html')} (${(html.length / 1024).toFixed(1)} kB, ${Object.keys(links).length} Try-it links)`);
