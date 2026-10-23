import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { checkSpec } from './check';
import { runHeadless } from '../script/testkit';
import { API_NAMES } from '../script/api';
import { exampleSpec, listExamples } from './examples';
import { DEMOS } from '../demos';
import { DEFAULT_BASE_URL, EXPR_PARAMS, GLOBAL_PARAMS, bytesToBase64Url, readUrlPayload } from './url';
import {
  ANIM_MODES,
  COLOR_NAMES,
  DRAG_MODES,
  EXPRESSION_KEYS,
  FEATURE_KEYS,
  LIMITS,
  PANEL_KEYS,
  POINT_DIRS,
  TOP_KEYS,
  VIEWPORT_KEYS,
} from './spec';

// The agent-facing docs are part of the API: every example in them must work.
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const LLMS = readFileSync(root('public/llms.txt'), 'utf8');
const SCHEMA = JSON.parse(readFileSync(root('public/fluxion-spec.schema.json'), 'utf8'));
const INDEX = readFileSync(root('index.html'), 'utf8');

function blocks(lang: string): string[] {
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  return [...LLMS.matchAll(re)].map((m) => m[1]);
}

// Example links sit on their own lines; links inside code blocks are templates
// ("#z=..."), not examples.
const URL_RE = /https:\/\/osmansiddiquer\.github\.io\/Fluxion\/[#?]\S+/g;
const proseUrls = (LLMS.replace(/```[\s\S]*?```/g, '').match(URL_RE) ?? []).map((u) => u.replace(/[.,]$/, ''));

describe('llms.txt', () => {
  it('follows the llms.txt shape (H1, summary blockquote)', () => {
    expect(LLMS.startsWith('# Fluxion\n\n> ')).toBe(true);
    expect(LLMS).toContain(DEFAULT_BASE_URL);
  });

  const exampleBlocks = blocks('fluxion');
  it('has expression examples for every kind', () => {
    const kinds = new Set(exampleBlocks.flatMap((b) => [...b.matchAll(/#\s*(\w+)\s*$/gm)].map((m) => m[1])));
    expect([...kinds].sort()).toEqual(
      ['condition', 'fndef', 'function', 'implicit', 'layer', 'inequality', 'ode', 'parametric', 'pointvar', 'points', 'polar', 'repeat', 'variable'].sort(),
    );
  });

  exampleBlocks.forEach((block, bi) => {
    const lines = block
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const m = l.match(/^(.*?)\s+#\s*(\w+)\s*$/);
        if (!m) throw new Error(`example line without "# kind": ${l}`);
        return { expr: m[1].trim(), kind: m[2] };
      });
    it(`example graph #${bi + 1} parses as documented: ${lines.map((l) => l.expr).join(' | ')}`, () => {
      const r = checkSpec({ expressions: lines.map((l) => l.expr), viewport: { xmin: -10, xmax: 10, ymin: -7.5, ymax: 7.5 } });
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.expressions.map((e) => e.kind)).toEqual(lines.map((l) => l.kind));
    });
  });

  const pitfalls = blocks('pitfalls').flatMap((b) => b.split('\n').filter((l) => l.trim()));
  it('lists pitfalls', () => expect(pitfalls.length).toBeGreaterThanOrEqual(6));
  for (const line of pitfalls) {
    const [wrong, right] = line.split('=>').map((s) => s.trim());
    it(`pitfall: "${wrong}" fails, "${right}" works`, () => {
      const bad = checkSpec({ expressions: [wrong] });
      const flagged = !bad.ok || bad.warnings.some((w) => /LaTeX/.test(w.message));
      expect(flagged).toBe(true);
      const good = checkSpec({ expressions: right.split(' ; ') });
      expect(good.errors).toEqual([]);
    });
  }

  it('contains example links', () => expect(proseUrls.length).toBeGreaterThanOrEqual(6));
  for (const link of proseUrls) {
    it(`example link works: ${link.slice(0, 110)}`, async () => {
      const u = new URL(link);
      const p = await readUrlPayload(u.hash, u.search);
      if (/[#?&]example=/.test(link)) {
        // Opens a built-in demo (a full graph, not a spec).
        expect(p.kind).toBe('legacy');
        if (p.kind === 'legacy') expect(p.graph.entries.length + (p.graph.script?.code ? 1 : 0)).toBeGreaterThan(0);
        return;
      }
      expect(p.kind).toBe('spec');
      if (p.kind !== 'spec') return;
      expect(p.warnings).toEqual([]);
      const r = checkSpec(p.spec);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      if (r.spec?.script) expectScriptRuns(r.spec.script, specEntries(r.spec));
    });
  }

  it('the JSON example is a valid, working spec', () => {
    const json = blocks('json');
    expect(json.length).toBeGreaterThan(0);
    for (const j of json) {
      const r = checkSpec(JSON.parse(j));
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      if (r.spec?.script) expectScriptRuns(r.spec.script, specEntries(r.spec));
    }
  });

  const scripts = blocks('fluxion-script');
  it('has Script mode examples', () => expect(scripts.length).toBeGreaterThanOrEqual(2));
  scripts.forEach((code, i) => {
    it(`script example #${i + 1} runs and draws`, () => expectScriptRuns(code, []));
  });

  it('summarises the Script API (every name except plain Math aliases)', () => {
    const mathOnly = new Set(['asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'cbrt', 'sign', 'ceil', 'round', 'trunc', 'log2', 'log10', 'info']);
    const missing = API_NAMES.filter((n) => !mathOnly.has(n) && !LLMS.includes('`' + n) && !new RegExp(`[\\s(.]${n}\\(`).test(LLMS) && !LLMS.includes(` ${n} `));
    expect(missing).toEqual([]);
  });

  it('documents every params key', () => {
    for (const k of [...EXPR_PARAMS, ...GLOBAL_PARAMS, 'expr']) expect(LLMS).toContain('`' + k);
  });

  it('documents every JSON key', () => {
    for (const k of [...EXPRESSION_KEYS, ...VIEWPORT_KEYS, ...FEATURE_KEYS, ...PANEL_KEYS]) {
      expect(LLMS).toContain(k);
    }
  });

  it('the JavaScript snippet produces a working link', async () => {
    const [code] = blocks('javascript');
    const fluxionLink = new Function(`${code}; return fluxionLink;`)() as (s: unknown) => Promise<string>;
    const spec = { expressions: ["y'' = -y", 'y = cos(x)'] };
    const link = await fluxionLink(spec);
    expect(link.startsWith(DEFAULT_BASE_URL + '#z=')).toBe(true);
    const p = await readUrlPayload(new URL(link).hash, '');
    expect(p).toMatchObject({ kind: 'spec', spec });
  });

  it('raw DEFLATE (what the Python snippet makes with wbits=-15) decodes', async () => {
    const spec = { expressions: ["y' = -y", 'y = e^(-x)'] };
    const z = bytesToBase64Url(deflateRawSync(Buffer.from(JSON.stringify(spec)), { level: 9 }));
    expect(await readUrlPayload(`#z=${z}`, '')).toMatchObject({ kind: 'spec', spec });
  });

  const py = spawnSync('python3', ['--version']);
  it.skipIf(py.status !== 0)('the Python snippet produces a working link', async () => {
    const [code] = blocks('python');
    const r = spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const link = r.stdout.trim();
    const p = await readUrlPayload(new URL(link).hash, '');
    expect(p).toMatchObject({ kind: 'spec', spec: { expressions: ["y' = -y", 'y = e^(-x)'] } });
  });
});

function specEntries(spec: { expressions: { expr: string; hidden: boolean; t0?: number; ic?: number[] }[] }) {
  return spec.expressions.map((e) => ({ raw: e.expr, visible: !e.hidden, t0: e.t0, ic: e.ic }));
}

function expectScriptRuns(code: string, entries: { raw: string; visible: boolean; ic?: number[] }[]) {
  for (const time of [0, 1, 4.5]) {
    const r = runHeadless(code, { time, entries });
    expect(r.error, `t=${time}: ${r.error?.message}`).toBeUndefined();
    expect(r.frame.items.length).toBeGreaterThan(0);
  }
}

describe('fluxion-spec.schema.json stays in sync with the validator', () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  it('top-level keys', () => {
    expect(keys(SCHEMA.properties)).toEqual([...TOP_KEYS].sort());
    expect(SCHEMA.additionalProperties).toBe(false);
    expect(SCHEMA.anyOf).toEqual([{ required: ['expressions'] }, { required: ['script'] }]);
    expect(SCHEMA.properties.script.maxLength).toBe(LIMITS.maxScriptChars);
  });
  it('expression keys and enums', () => {
    const e = SCHEMA.$defs.expression;
    expect(keys(e.properties)).toEqual([...EXPRESSION_KEYS].sort());
    expect(e.additionalProperties).toBe(false);
    expect(e.properties.anim.enum).toEqual([...ANIM_MODES]);
    expect(e.properties.labelDir.enum).toEqual([...POINT_DIRS]);
    expect(e.properties.drag.enum).toEqual([...DRAG_MODES]);
    expect(e.properties.color.anyOf[1].enum).toEqual(Object.keys(COLOR_NAMES));
    expect(e.properties.ic.oneOf[1].maxItems).toBe(LIMITS.maxIcLength);
    expect(e.properties.label.maxLength).toBe(LIMITS.maxLabelLength);
  });
  it('viewport / features / panels keys', () => {
    expect(keys(SCHEMA.properties.viewport.properties)).toEqual([...VIEWPORT_KEYS].sort());
    expect(keys(SCHEMA.properties.features.properties)).toEqual([...FEATURE_KEYS].sort());
    expect(keys(SCHEMA.properties.panels.properties)).toEqual([...PANEL_KEYS].sort());
  });
  it('limits', () => {
    expect(SCHEMA.properties.expressions.maxItems).toBe(LIMITS.maxExpressions);
    expect(SCHEMA.$defs.exprString.maxLength).toBe(LIMITS.maxExprLength);
  });
  it('is the schema llms.txt links to', () => {
    expect(LLMS).toContain(SCHEMA.$id);
  });
});

describe('index.html', () => {
  it('points agents at llms.txt', () => {
    expect(INDEX).toMatch(/<link rel="help" type="text\/plain" href="llms.txt"/);
  });
});

describe('built-in examples for agents', () => {
  it('llms.txt lists every example with its link', () => {
    for (const ex of listExamples()) {
      expect(LLMS).toContain('`' + ex.id + '`');
      expect(LLMS).toContain(ex.link);
      if (ex.spec) expect(LLMS).toContain(DEFAULT_BASE_URL + ex.spec);
    }
  });

  it('public/examples/index.json is up to date (npm run examples)', () => {
    const index = JSON.parse(readFileSync(root('public/examples/index.json'), 'utf8'));
    expect(index).toEqual(listExamples());
  });

  for (const d of DEMOS) {
    const spec = exampleSpec(d.id);
    if (!spec) continue;
    it(`public/examples/${d.id}.json matches the demo and checks clean`, () => {
      const file = JSON.parse(readFileSync(root(`public/examples/${d.id}.json`), 'utf8'));
      expect(file).toEqual(spec);
      const r = checkSpec(file);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  }

  it('demos carrying a clip have no spec (they open by link only)', () => {
    for (const ex of listExamples()) {
      const g = DEMOS.find((d) => d.id === ex.id)!.build();
      expect(!!ex.spec).toBe(!g.assets);
    }
  });
});
