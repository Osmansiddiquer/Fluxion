import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECTIONS, allExamples, findSection, rowExample, type Block } from './content';
import { TOUR_EXAMPLES, exampleGraph, type DocExample } from './examples';
import { searchDocs, sectionPassages, stripMarkup } from './search';
import { docsHash, parseDocsHash } from './hash';
import { computeAll } from '../../lib/compute';
import { parseEntry } from '../../lib/math/parse';
import { HELPER_NAMES } from '../../lib/math/helpers';
import { isDerived } from '../../lib/scope';
import { COLOR_FUNCTION_NAMES, isColorExpr } from '../../lib/color';
import { hasUrlPayload, readUrlPayload } from '../../lib/api/url';
import { DEMOS } from '../../lib/demos';
import { registerAssets } from '../../lib/frames/assets';
import type { GraphData } from '../../lib/graphFile';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const src = (p: string) => readFileSync(root(p), 'utf8');

/** The graph "Try it" loads (demo-backed examples open the demo). */
function graphOf(ex: DocExample): GraphData {
  if (ex.demo) {
    const d = DEMOS.find((x) => x.id === ex.demo);
    if (!d) throw new Error(`unknown demo ${ex.demo}`);
    const g = d.build();
    registerAssets(g.assets);
    return g;
  }
  return exampleGraph(ex);
}

/** All prose text in the docs (markup intact), for "is X documented" checks. */
const ALL_TEXT = SECTIONS.flatMap((s) => [s.title, s.summary, ...JSON.stringify(s.blocks).split('\\n')]).join('\n');

const EXAMPLES = allExamples();

describe('docs content structure', () => {
  it('has the sections in learning order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'getting-started',
      'curves',
      'odes',
      'sliders',
      'inspect',
      'drawing',
      'animation',
      'clips',
      'sharing',
      'keyboard',
      'agents',
      'scripting',
    ]);
  });

  it('section ids are unique, URL-safe and every section has content', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SECTIONS) {
      expect(s.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(s.title.length).toBeGreaterThan(2);
      expect(s.summary.length).toBeGreaterThan(10);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it('example ids are unique', () => {
    const ids = EXAMPLES.map((e) => e.example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every in-page #section link points at a real section', () => {
    const links = [...ALL_TEXT.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(3);
    for (const id of links) expect(findSection(id), id).toBeDefined();
  });

  it('inline markup is balanced (backticks, bold, maths)', () => {
    const strings: string[] = [];
    const walk = (b: Block) => {
      if (b.type === 'p' || b.type === 'h' || b.type === 'tip') strings.push(b.text);
      if (b.type === 'list' || b.type === 'steps') strings.push(...b.items);
      if (b.type === 'table') strings.push(...b.head, ...b.rows.flat());
    };
    SECTIONS.forEach((s) => s.blocks.forEach(walk));
    for (const t of strings) {
      expect((t.match(/`/g) ?? []).length % 2, t).toBe(0);
      expect((t.match(/\*\*/g) ?? []).length % 2, t).toBe(0);
      expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0);
    }
  });

  it('table rows have as many cells as the header', () => {
    for (const s of SECTIONS)
      for (const b of s.blocks) if (b.type === 'table') for (const r of b.rows) expect(r.length, r.join(' | ')).toBe(b.head.length);
  });

  it('the Script mode reference documents every Script API name', async () => {
    const { DOCS } = await import('../Script/docsContent');
    const { API_NAMES } = await import('../../lib/script/api');
    const text = JSON.stringify(DOCS);
    expect(API_NAMES.filter((n) => !new RegExp(`\\b${n}\\b`).test(text))).toEqual([]);
  });

  it('the home page offers the tour and the Scripting section has the Script docs slot', () => {
    expect(SECTIONS[0].blocks.some((b) => b.type === 'tour')).toBe(true);
    expect(findSection('scripting')!.blocks.some((b) => b.type === 'script-docs')).toBe(true);
  });
});

describe('every docs example parses as documented and computes', () => {
  it('there are plenty of examples', () => expect(EXAMPLES.length).toBeGreaterThan(60));

  for (const { section, example } of EXAMPLES) {
    it(`${section.id} › ${example.title}`, () => {
      const g = graphOf(example);
      if (!example.demo) {
        expect(g.entries.map((e) => parseEntry(e.raw).kind)).toEqual(example.lines.map((l) => l.kind));
      }
      const res = computeAll(g.entries, g.viewport, 400);
      let drawn = 0;
      for (const e of g.entries) {
        const r = res.get(e.id)!;
        const isClipRow = r.parsed.kind === 'frames' && !e.frames;
        expect(r.parsed.kind, e.raw).not.toBe('error');
        if (!isClipRow) expect(r.error, e.raw).toBeUndefined();
        expect(r.undefinedVars ?? [], e.raw).toEqual([]);
        expect(r.unknownFns ?? [], e.raw).toEqual([]);
        if (e.colorExpr) expect(isColorExpr(e.colorExpr), e.colorExpr).toBe(true);
        if (e.fillColor) expect(isColorExpr(e.fillColor), e.fillColor).toBe(true);
        if (r.curve.segments.length || r.points?.length || r.inequality) drawn++;
        // The "derived" tag is exactly the derived values (a named function of no x/t).
        const line = example.lines[g.entries.indexOf(e)];
        if (line) expect(!!line.derived, `${e.raw} derived tag`).toBe(isDerived(r.parsed));
      }
      // Something visible, unless the snippet is a lone slider/definition row
      // or a clip row with no clip attached (only a file can carry one).
      const loneDef = g.entries.every((e) => ['variable', 'frames'].includes(parseEntry(e.raw).kind));
      if (!loneDef) expect(drawn).toBeGreaterThan(0);
    });
  }
});

describe('docs cover every feature', () => {
  // Read the parse kinds straight from the Parsed union, so a new kind fails here
  // until it is documented.
  const parseSrc = src('src/lib/math/parse.ts');
  const start = parseSrc.indexOf('export type Parsed =');
  const block = parseSrc.slice(start, parseSrc.indexOf('\n\n', start));
  const kinds = [...block.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]).filter((k) => k !== 'empty' && k !== 'error');

  it('found the parse kinds', () => {
    expect(kinds.sort()).toEqual(
      ['fndef', 'frames', 'function', 'implicit', 'inequality', 'layer', 'ode', 'parametric', 'pointvar', 'points', 'polar', 'repeat', 'variable'].sort(),
    );
  });

  const documented = new Set<string>();
  for (const { example } of EXAMPLES) {
    for (const l of example.lines) documented.add(l.kind);
    if (example.demo) for (const e of graphOf(example).entries) documented.add(parseEntry(e.raw).kind);
  }
  for (const k of kinds) {
    it(`parse kind "${k}" has a docs example or syntax row`, () => expect(documented.has(k)).toBe(true));
  }

  for (const h of HELPER_NAMES) {
    it(`scripting helper ${h}() is documented`, () => expect(ALL_TEXT).toContain('`' + h + '('));
  }
  for (const c of COLOR_FUNCTION_NAMES) {
    it(`colour function ${c}() is documented`, () => expect(ALL_TEXT).toContain('`' + c + '('));
  }

  it('documents every built-in Example by title', () => {
    for (const d of DEMOS) expect(ALL_TEXT).toContain(d.title);
  });

  it('documents the agent-facing files', () => {
    for (const f of ['llms.txt', 'fluxion-spec.schema.json', '#example=', '#expr=']) expect(ALL_TEXT).toContain(f);
  });

  it('documents every marker family the Points menu toggles', () => {
    const ft = src('src/components/Plot/FeatureToggle.tsx');
    const labels = [...ft.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(4);
    for (const l of labels) expect(ALL_TEXT).toContain(l);
  });

  it('documents every share-menu item', () => {
    for (const item of ['Copy share link', 'Copy as JSON spec', 'Export to file…', 'Import from file…']) {
      expect(src('src/components/GraphMenu.tsx')).toContain(item);
      expect(ALL_TEXT).toContain(item);
    }
  });
});

describe('the tour and the docs share their examples', () => {
  const docsExamples = SECTIONS.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'example' ? [b.example] : []));

  it('every tour example appears in the docs (the same object)', () => {
    expect(TOUR_EXAMPLES).toHaveLength(4);
    for (const t of TOUR_EXAMPLES) expect(docsExamples).toContain(t);
  });

  it('Tutorial.tsx takes its examples from the shared module', () => {
    const tut = src('src/components/Tutorial.tsx');
    expect(tut).toMatch(/import \{[^}]*TOUR_EXAMPLES[^}]*\} from '\.\/Docs\/examples'/);
    expect(tut).not.toMatch(/entries:\s*\[/); // no private copy of example data
  });

  it('tour examples load the same graph from either place', () => {
    for (const t of TOUR_EXAMPLES) {
      const a = exampleGraph(t);
      const b = exampleGraph(t);
      expect(a.entries.map(({ id: _id, ...e }) => e)).toEqual(b.entries.map(({ id: _id, ...e }) => e));
      expect(a.entries[0].id).not.toBe(b.entries[0].id); // fresh ids each load
    }
  });
});

describe('docs deep links', () => {
  it('parses #docs and #docs/<section>', () => {
    expect(parseDocsHash('#docs')).toEqual({});
    expect(parseDocsHash('#docs/')).toEqual({});
    expect(parseDocsHash('#docs/odes')).toEqual({ section: 'odes' });
    expect(parseDocsHash('#DOCS/Getting-Started')).toEqual({ section: 'getting-started' });
  });

  it('round-trips every section', () => {
    for (const s of SECTIONS) expect(parseDocsHash(docsHash(s.id))).toEqual({ section: s.id });
    expect(parseDocsHash(docsHash())).toEqual({});
  });

  it('rejects anything else', () => {
    for (const h of ['', '#', '#doc', '#docsx', '#docs/a/b', '#docs=1', '#docs/odes&expr=y=x', '#/docs', '?docs', '#docs/ode s']) {
      expect(parseDocsHash(h), h).toBeNull();
    }
  });

  it('never collides with the URL API', async () => {
    const api = ['#expr=y=sin(x)', '#spec=%7B%7D', '#z=abc', '#g=abc', '#example=cube', '#expr=docs', '#example=docs'];
    for (const h of api) {
      expect(parseDocsHash(h), h).toBeNull();
      expect(hasUrlPayload(h, ''), h).toBe(true);
    }
    for (const s of [undefined, ...SECTIONS.map((x) => x.id)]) {
      const h = docsHash(s);
      expect(hasUrlPayload(h, ''), h).toBe(false);
      expect((await readUrlPayload(h, '')).kind, h).toBe('none');
    }
  });
});

describe('docs search', () => {
  const ids = (q: string) => searchDocs(SECTIONS, q).map((h) => h.section.id);

  it('empty query finds nothing', () => {
    expect(searchDocs(SECTIONS, '')).toEqual([]);
    expect(searchDocs(SECTIONS, '   ')).toEqual([]);
  });

  it('finds sections by body text, case-insensitively', () => {
    expect(ids('lorenz')).toContain('odes');
    expect(ids('LORENZ')).toContain('odes');
    expect(ids('blow')).toContain('odes');
    expect(ids('skeys')).toContain('drawing');
    expect(ids('ffmpeg')).toEqual(['clips']);
    expect(ids('llms.txt')).toContain('agents');
  });

  it('every query word must match', () => {
    expect(ids('lorenz ffmpeg')).toEqual([]);
    expect(ids('xyzzy')).toEqual([]);
  });

  it('title matches rank first', () => {
    expect(ids('clips')[0]).toBe('clips');
    expect(ids('sliders')[0]).toBe('sliders');
    expect(ids('differential')[0]).toBe('odes');
  });

  it('snippets are plain text containing the match', () => {
    const [hit] = searchDocs(SECTIONS, 'ffmpeg');
    expect(hit.snippet.toLowerCase()).toContain('ffmpeg');
    expect(hit.snippet).not.toContain('`');
  });

  it('accent-insensitive', () => {
    expect(ids('mangekyo')).toContain('drawing');
  });

  it('strips markup', () => {
    expect(stripMarkup('**bold** `code` [link](#docs/odes) $t_0$')).toBe('bold code link t 0');
    expect(sectionPassages(SECTIONS[0]).join(' ')).not.toMatch(/\*\*|`/);
  });

  it('syntax rows are searchable', () => {
    expect(ids('hypot')).toContain('drawing');
    expect(ids("y'' + 0.4y'")).toContain('odes');
  });
});

describe('syntax row helper', () => {
  it('loads the row after the rows it needs', () => {
    const s = findSection('sliders')!;
    const b = s.blocks.find((x) => x.type === 'syntax')!;
    if (b.type !== 'syntax') throw new Error();
    const r = b.rows.find((x) => x.with)!;
    const ex = rowExample(s.id, r, 0);
    expect(ex.lines.at(-1)!.raw).toBe(r.input);
    expect(ex.lines.length).toBe((r.with?.length ?? 0) + 1);
  });
});
