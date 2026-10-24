import { checkSpec, type CheckReport } from '../lib/api/check';
import { buildLink, linkToSpec, DEFAULT_BASE_URL, type LinkFormat } from '../lib/api/url';
import type { FluxionSpec, Issue, NormalizedSpec } from '../lib/api/spec';
import { exampleSpec, listExamples } from '../lib/api/examples';
import { specToGraph } from '../lib/api/spec';
import { checkScript, type ScriptCheckReport } from './scriptCheck';
import { graphEntryData, type GraphEntryData } from '../lib/script/protocol';

/**
 * Command-line client for the Fluxion URL API, using the app's real parser so
 * an agent with a shell can check a graph before sending a link.
 *
 *   npm run fluxion -- link  '{"expressions":["y = sin(x)"]}'
 *   npm run fluxion -- link  --expr "y' = -y" --ic 1 --xmin 0 --xmax 5
 *   npm run fluxion -- check spec.json
 *   npm run fluxion -- decode 'https://osmansiddiquer.github.io/Fluxion/#z=…'
 *
 * All I/O goes through `CliIO` so the whole CLI is unit-tested in-process.
 */

export interface CliIO {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
  out(text: string): void;
  err(text: string): void;
}

export const HELP = `fluxion — build and check Fluxion graph links (https://osmansiddiquer.github.io/Fluxion/)

Usage:
  fluxion link   [SPEC] [options]   Validate a graph and print a shareable link
  fluxion check  [SPEC] [options]   Print a JSON report: how each expression parses + problems
  fluxion script FILE.js [--time T,T…] [--spec SPEC]
                                    Run a Script mode program headlessly (sandboxed, with a
                                    timeout) and print a JSON report: errors with lines, and
                                    what it drew at each time. SPEC supplies Graph-mode
                                    expressions for graph.ode / graph.fn / graph.value.
  fluxion decode URL                Print the JSON spec carried by a Fluxion link
  fluxion examples                  List the built-in scripted demos and their links
  fluxion example ID                Print a demo's JSON spec, a template to edit
  fluxion help

SPEC is a JSON spec as a file path, "-" for stdin, or inline JSON ('{"expressions":[…]}').
Instead of (or in addition to) a SPEC you can build one with flags:
  --expr EXPR            add an expression (repeatable), e.g. --expr "y = sin(x)"
  --color C --ic A,B --t0 N --min N --max N --step N --hidden
                         options for the most recent --expr
  --xmin N --xmax N --ymin N --ymax N
                         viewport (x is the horizontal axis)
Link options:
  --format z|json|b64|params   link encoding (default z: compressed, shortest;
                               params: human-readable #expr=… when possible)
  --base URL             app URL (default ${DEFAULT_BASE_URL})
  --force                print a link even if the check finds errors

Exit status: 0 ok, 1 the graph has errors, 2 usage / input problem.
Spec format and expression syntax: ${DEFAULT_BASE_URL}llms.txt`;

const FORMATS: LinkFormat[] = ['z', 'json', 'b64', 'params'];
const EXPR_FLAGS = ['color', 'ic', 't0', 'min', 'max', 'step'] as const;
const VIEW_FLAGS = ['xmin', 'xmax', 'ymin', 'ymax'] as const;

class UsageError extends Error {}

interface Parsed {
  cmd: string;
  positional: string[];
  exprs: Record<string, unknown>[];
  viewport: Record<string, unknown>;
  format: LinkFormat;
  base?: string;
  force: boolean;
  times?: number[];
  specArg?: string;
}

const num = (v: string) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);

function parseArgs(argv: string[]): Parsed {
  const [cmd = 'help', ...rest] = argv;
  const p: Parsed = { cmd, positional: [], exprs: [], viewport: {}, format: 'z', force: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--') || a === '--') {
      if (a !== '--') p.positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
    const takeValue = () => {
      if (eq > 0) return a.slice(eq + 1);
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      return v;
    };
    if (name === 'force') p.force = true;
    else if (name === 'time') {
      const ts = takeValue().split(',').map(Number);
      if (!ts.length || ts.some((t) => !Number.isFinite(t))) throw new UsageError('--time takes numbers, e.g. --time 0,1,2.5');
      p.times = ts;
    } else if (name === 'spec') p.specArg = takeValue();
    else if (name === 'hidden') {
      const last = p.exprs[p.exprs.length - 1];
      if (!last) throw new UsageError('--hidden must follow an --expr');
      last.hidden = true;
    } else if (name === 'expr') p.exprs.push({ expr: takeValue() });
    else if (name === 'format') {
      const f = takeValue() as LinkFormat;
      if (!FORMATS.includes(f)) throw new UsageError(`--format must be one of ${FORMATS.join(', ')}`);
      p.format = f;
    } else if (name === 'base') p.base = takeValue();
    else if ((VIEW_FLAGS as readonly string[]).includes(name)) p.viewport[name] = num(takeValue());
    else if ((EXPR_FLAGS as readonly string[]).includes(name)) {
      const last = p.exprs[p.exprs.length - 1];
      if (!last) throw new UsageError(`--${name} must follow an --expr`);
      const v = takeValue();
      last[name] = name === 'ic' ? v.split(',').map(num) : name === 'color' ? v : num(v);
    } else throw new UsageError(`unknown option --${name} (see: fluxion help)`);
  }
  return p;
}

async function loadSpec(p: Parsed, io: CliIO): Promise<unknown> {
  let spec: unknown;
  const src = p.positional[0];
  if (src !== undefined) {
    const text = src === '-' ? await io.readStdin() : /^\s*[[{]/.test(src) ? src : await io.readFile(src);
    try {
      spec = JSON.parse(text);
    } catch (e) {
      throw new UsageError(`spec is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (p.exprs.length || Object.keys(p.viewport).length) {
    const base: Record<string, unknown> =
      spec === undefined ? { expressions: [] } : Array.isArray(spec) ? { expressions: spec } : (spec as Record<string, unknown>);
    if (!base || typeof base !== 'object') throw new UsageError('cannot add --expr to a non-object spec');
    const exprs = Array.isArray(base.expressions) ? base.expressions : [];
    base.expressions = [...exprs, ...p.exprs.map((e) => (Object.keys(e).length === 1 ? e.expr : e))];
    if (Object.keys(p.viewport).length) {
      base.viewport = { ...((base.viewport as object) ?? {}), ...p.viewport };
    }
    spec = base;
  }
  if (spec === undefined) throw new UsageError('no graph given: pass a SPEC or --expr (see: fluxion help)');
  return spec;
}

function entriesOf(spec: unknown): GraphEntryData[] {
  const v = checkSpec(spec);
  return v.spec ? graphEntries(v.spec) : [];
}

/** The Graph-mode expressions a script reads (graph.ode / fn / value). */
function graphEntries(spec: NormalizedSpec): GraphEntryData[] {
  return specToGraph(spec).entries.map(graphEntryData);
}

/** Run a spec's script (if any) and fold its problems into the report. */
async function withScript(r: CheckReport): Promise<CheckReport & { script?: ScriptCheckReport }> {
  const code = r.spec?.script;
  if (!code) return r;
  // r.spec is already validated and normalised: re-checking it would fail.
  const s = await checkScript(code, { entries: r.spec ? graphEntries(r.spec) : [] });
  const errors = [
    ...r.errors,
    ...s.errors.map((e) => ({ path: 'script', message: `${e.line ? `line ${e.line}: ` : ''}${e.message} (at time ${e.time})` })),
  ];
  return { ...r, ok: r.ok && s.ok, errors, script: s };
}

const fmtIssue = (kind: string, i: Issue) => `${kind}: ${i.path ? i.path + ': ' : ''}${i.message}`;

function describeReport(r: CheckReport): string {
  return [
    ...r.expressions.map((e) => `  [${e.index}] ${e.expr}  →  ${e.summary}`),
    ...r.errors.map((i) => fmtIssue('error', i)),
    ...r.warnings.map((i) => fmtIssue('warning', i)),
  ].join('\n');
}

/** Run the CLI. Resolves to the process exit code. */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  try {
    const p = parseArgs(argv);
    switch (p.cmd) {
      case 'help':
      case '--help':
      case '-h':
        io.out(HELP);
        return 0;
      case 'check': {
        const r = await withScript(checkSpec(await loadSpec(p, io)));
        const { spec: _spec, ...report } = r;
        io.out(JSON.stringify(report, null, 2));
        return r.ok ? 0 : 1;
      }
      case 'link': {
        const spec = await loadSpec(p, io);
        const r = await withScript(checkSpec(spec));
        const summary = describeReport(r);
        if (summary) io.err(summary);
        if (!r.ok && !p.force) {
          io.err('Not creating a link: fix the errors above (or pass --force).');
          return 1;
        }
        io.out(await buildLink(spec as FluxionSpec, { format: p.format, base: p.base }));
        return r.ok ? 0 : 1;
      }
      case 'script': {
        const file = p.positional[0];
        if (!file) throw new UsageError('script needs a file (or "-" for stdin)');
        const code = file === '-' ? await io.readStdin() : await io.readFile(file);
        let entries: GraphEntryData[] = [];
        if (p.specArg) {
          const text = /^\s*[[{]/.test(p.specArg) ? p.specArg : await io.readFile(p.specArg);
          try {
            entries = entriesOf(JSON.parse(text));
          } catch (e) {
            throw new UsageError(`--spec is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const r = await checkScript(code, { entries, times: p.times });
        io.out(JSON.stringify(r, null, 2));
        return r.ok ? 0 : 1;
      }
      case 'decode': {
        const url = p.positional[0];
        if (!url) throw new UsageError('decode needs a URL');
        const d = await linkToSpec(url);
        for (const w of d.warnings) io.err(`warning: ${w}`);
        if (d.error) {
          io.err(d.error);
          return 2;
        }
        io.out(JSON.stringify(d.spec, null, 2));
        return 0;
      }
      case 'examples': {
        for (const ex of listExamples(p.base)) io.out(`${ex.id.padEnd(10)} ${ex.title}\n           ${ex.blurb}\n           ${ex.link}`);
        return 0;
      }
      case 'example': {
        const id = p.positional[0];
        if (!id) throw new UsageError('example needs an id (see: fluxion examples)');
        const known = listExamples(p.base).find((e) => e.id === id);
        if (!known) throw new UsageError(`no example "${id}" (see: fluxion examples)`);
        const spec = exampleSpec(id);
        if (!spec) {
          io.err(`"${id}" carries an imported clip, so it has no JSON spec; open it with ${known.link}`);
          return 2;
        }
        io.out(JSON.stringify(spec, null, 2));
        return 0;
      }
      default:
        throw new UsageError(`unknown command "${p.cmd}" (see: fluxion help)`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`fluxion: ${e.message}`);
      return 2;
    }
    io.err(`fluxion: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}
