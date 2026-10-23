import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECTIONS, allExamples } from '../components/Docs/content';
import { HELPER_NAMES } from '../lib/math/helpers';
import { loadFromUrl } from '../lib/api/load';
import { readUrlPayload } from '../lib/api/url';
import { computeAll } from '../lib/compute';
import { parseEntry } from '../lib/math/parse';
import { registerAssets } from '../lib/frames/assets';
import { DEMOS } from '../lib/demos';
import { APP_BASE, tryLinks } from './links';
import { HEAD_TAGS, injectDocs, renderDocs, scriptJson } from './prerender';
import { headingId, kindLabel } from './DocsPage';
import { activeSection } from './scrollspy';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const src = (p: string) => readFileSync(root(p), 'utf8');

/** What React's renderToString does to text. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const EXAMPLES = allExamples();
const LINKS = await tryLinks();
const { body: BODY, data: DATA } = renderDocs(LINKS);
/** The deployed page lives at /Fluxion/docs/; Try links are relative to it. */
const PAGE = 'https://osmansiddiquer.github.io/Fluxion/docs/';

describe('pre-rendered docs page', () => {
  it('contains every section, with its anchor, title and summary', () => {
    for (const s of SECTIONS) {
      expect(BODY).toContain(`id="${s.id}"`);
      expect(BODY).toContain(esc(s.title));
      expect(BODY).toContain(esc(s.summary));
      expect(BODY).toContain(`href="#${s.id}"`); // nav entry
    }
  });

  it('contains every sub-heading with an anchor', () => {
    for (const s of SECTIONS)
      for (const b of s.blocks) if (b.type === 'h') expect(BODY).toContain(`id="${headingId(s.id, b.text)}"`);
  });

  it('contains every snippet and syntax row', () => {
    let n = 0;
    for (const s of SECTIONS)
      for (const b of s.blocks) {
        const shown = b.type === 'example' ? b.example.lines.map((l) => l.raw) : b.type === 'syntax' ? b.rows.map((r) => r.input) : [];
        for (const raw of shown) {
          expect(BODY, raw).toContain(`<code>${esc(raw)}</code>`);
          n++;
        }
      }
    expect(n).toBeGreaterThan(80);
  });

  it('contains every Try link, opening in a new tab', () => {
    const n = (BODY.match(/class="dp-try"/g) ?? []).length;
    expect(n).toBe(EXAMPLES.length);
    for (const { example } of EXAMPLES) expect(BODY).toContain(`href="${esc(LINKS[example.id])}" target="_blank"`);
  });

  it('documents every scripting helper in the static HTML', () => {
    for (const h of HELPER_NAMES) expect(BODY).toContain(`<code>${h}(`);
  });

  it('renders maths with KaTeX at build time, and embeds it for hydration', () => {
    expect(BODY).toContain('class="katex"');
    const tex = Object.values(DATA.tex);
    expect(tex.length).toBeGreaterThan(5);
    for (const h of tex) expect(BODY).toContain(h);
    expect(DATA.links).toBe(LINKS);
  });

  it('shows the Script mode placeholder in the static HTML', () => {
    expect(BODY).toContain('Script mode is coming');
  });

  it('labels derived values', () => {
    expect(kindLabel('function', true)).toBe('derived');
    expect(kindLabel('function')).toBe('function');
    expect(BODY).toContain('>derived<');
  });

  it('links to the app, llms.txt and the schema relative to /docs/', () => {
    expect(BODY).toContain('href="../"');
    expect(BODY).toContain('href="../llms.txt"');
    expect(BODY).toContain('href="../fluxion-spec.schema.json"');
  });
});

describe('injectDocs', () => {
  const template = `<html><head><!--docs-head--><script type="module" crossorigin src="../../assets/docs-abc.js"></script><link rel="stylesheet" href="../../assets/docs-abc.css"></head><body><div id="docs-root"><!--docs-body--></div><!--docs-data--></body></html>`;
  const html = injectDocs(template, '<p>$& body</p>', { links: { a: '../#z=x</script>' }, tex: {} });

  it('inserts the body verbatim (no $-pattern expansion)', () => expect(html).toContain('<div id="docs-root"><p>$& body</p></div>'));
  it('rewrites asset paths for dist/docs/index.html', () => {
    expect(html).toContain('src="./assets/docs-abc.js"');
    expect(html).toContain('href="./assets/docs-abc.css"');
    expect(html).not.toContain('../../assets');
  });
  it('adds the head tags, including llms.txt as an alternate', () => {
    expect(html).toContain(HEAD_TAGS);
    expect(HEAD_TAGS).toContain('rel="alternate" type="text/plain" href="../llms.txt"');
    expect(HEAD_TAGS).toContain('href="../favicon.svg"');
  });
  it('embeds the links as JSON that cannot break out of the script tag', () => {
    expect(html).toContain('<script id="docs-data" type="application/json">');
    expect(html).not.toContain('x</script>');
    expect(JSON.parse(scriptJson({ a: '</script>' }))).toEqual({ a: '</script>' });
  });
  it('fails loudly if the template lost a marker', () => {
    expect(() => injectDocs('<html></html>', '', { links: {}, tex: {} })).toThrow(/docs-head/);
  });
});

describe('Try it links open the example in the app', () => {
  it('there is one per example and they are relative to the docs page', () => {
    expect(Object.keys(LINKS).sort()).toEqual(EXAMPLES.map((e) => e.example.id).sort());
    for (const l of Object.values(LINKS)) expect(l.startsWith(`${APP_BASE}#`)).toBe(true);
  });

  for (const { section, example } of EXAMPLES) {
    it(`${section.id} › ${example.title}`, async () => {
      const url = new URL(LINKS[example.id], PAGE);
      expect(url.pathname).toBe('/Fluxion/');
      const payload = await readUrlPayload(url.hash, url.search);
      expect(payload.kind).toBe(example.demo ? 'legacy' : 'spec');
      const r = await loadFromUrl(url.hash, url.search);
      expect(r?.tone).toBe('info');
      const g = r!.graph!;
      if (example.demo) {
        expect(g.entries.length).toBe(DEMOS.find((d) => d.id === example.demo)!.build().entries.length);
        registerAssets(g.assets);
      } else {
        expect(g.entries.map((e) => e.raw)).toEqual(example.lines.map((l) => l.raw));
        expect(g.entries.map((e) => parseEntry(e.raw).kind)).toEqual(example.lines.map((l) => l.kind));
      }
      const res = computeAll(g.entries, g.viewport, 300);
      for (const e of g.entries) {
        const c = res.get(e.id)!;
        expect(c.parsed.kind, e.raw).not.toBe('error');
        if (c.parsed.kind !== 'frames' || e.frames) expect(c.error, e.raw).toBeUndefined();
        expect(c.undefinedVars ?? [], e.raw).toEqual([]);
      }
    });
  }
});

describe('the build includes the docs page', () => {
  const pkg = JSON.parse(src('package.json'));
  const docsConfig = src('vite.docs.config.mjs');

  it('npm run build builds and pre-renders the docs after the app', () => {
    expect(pkg.scripts.build).toMatch(/vite build && npm run build:docs$/);
    expect(pkg.scripts['build:docs']).toBe('vite build --config vite.docs.config.mjs && vite-node scripts/prerender-docs.ts');
  });

  it('the docs config builds src/docs-page into dist/docs with relative URLs and no public dir', () => {
    expect(docsConfig).toContain("outDir: 'dist/docs'");
    expect(docsConfig).toContain("'./src/docs-page/index.html'");
    expect(docsConfig).toContain("base: './'");
    expect(docsConfig).toContain('publicDir: false');
  });

  it('the template has the markers prerender fills, and the dev server serves it at /docs/', () => {
    const t = src('src/docs-page/index.html');
    for (const m of ['<!--docs-head-->', '<!--docs-body-->', '<!--docs-data-->', 'src="/src/docs-page/main.tsx"']) expect(t).toContain(m);
    expect(src('vite.config.mjs')).toContain("'/src/docs-page/index.html'");
  });

  it('the app links to it', () => {
    expect(src('src/config.ts')).toContain("DOCS_HREF = 'docs/'");
    expect(src('src/components/HelpMenu.tsx')).toMatch(/href=\{DOCS_HREF\}\s+target="_blank"/);
    expect(src('src/components/Tutorial.tsx')).toMatch(/href=\{DOCS_HREF\} target="_blank"/);
  });

  // After `npm run build`, check the real output too.
  const built = root('dist/docs/index.html');
  it.skipIf(!existsSync(built))('dist/docs/index.html is pre-rendered and hydratable', () => {
    const html = readFileSync(built, 'utf8');
    for (const s of SECTIONS) expect(html).toContain(`id="${s.id}"`);
    expect(html).toContain('<script id="docs-data" type="application/json">');
    expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/);
    expect(html).not.toMatch(/<!--docs-(head|body|data)-->/);
    expect(existsSync(root('dist/docs/src'))).toBe(false);
  });
});

describe('scroll-spy: activeSection', () => {
  const at = (...tops: number[]) => tops.map((top, i) => ({ id: `s${i}`, top }));
  const HEADER = 60;

  it('picks the section whose heading sits at or just below the header', () => {
    // After jumping to #s2: s2's top lands at header + scroll-margin (72).
    expect(activeSection(at(-2400, -900, 72, 900), HEADER, false)).toBe('s2');
    expect(activeSection(at(-2400, -900, 60, 900), HEADER, false)).toBe('s2');
  });
  it('does not lag one section behind (the previous one is still on screen)', () => {
    expect(activeSection(at(-500, -20, 100, 800), HEADER, false)).toBe('s2');
  });
  it('keeps the current section until the next one reaches the header', () => {
    expect(activeSection(at(-500, -20, 400, 1200), HEADER, false)).toBe('s1');
  });
  it('is the first section at the top of the page', () => {
    expect(activeSection(at(130, 900, 1800), HEADER, false)).toBe('s0');
  });
  it('is the last section at the very bottom, even if it cannot reach the header', () => {
    expect(activeSection(at(-3000, -600, 300, 650), HEADER, true)).toBe('s3');
  });
  it('accounts for a taller header (phone menu bar)', () => {
    expect(activeSection(at(-900, 110, 900), 105, false)).toBe('s1');
    expect(activeSection(at(-900, 200, 900), 105, false)).toBe('s0');
  });
  it('handles no sections', () => expect(activeSection([], HEADER, false)).toBeNull());
});
