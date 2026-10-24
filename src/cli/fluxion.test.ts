import { describe, expect, it } from 'vitest';
import { HELP, runCli, type CliIO } from './fluxion';
import { readUrlPayload, DEFAULT_BASE_URL } from '../lib/api/url';
import { validateSpec } from '../lib/api/spec';

function io(files: Record<string, string> = {}, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = {
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: no such file '${p}'`);
      return files[p];
    },
    readStdin: async () => stdin,
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { cli, out, err };
}

async function run(argv: string[], files?: Record<string, string>, stdin?: string) {
  const t = io(files, stdin);
  const code = await runCli(argv, t.cli);
  return { code, out: t.out.join('\n'), err: t.err.join('\n') };
}

async function specOf(link: string) {
  const u = new URL(link);
  const p = await readUrlPayload(u.hash, u.search);
  if (p.kind !== 'spec') throw new Error('not a spec link: ' + link);
  return p.spec;
}

describe('fluxion CLI', () => {
  it('prints help', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const r = await run(argv);
      expect(r.code).toBe(0);
      expect(r.out).toBe(HELP);
    }
  });

  describe('link', () => {
    it('builds a compressed link from inline JSON', async () => {
      const r = await run(['link', '{"expressions":["y = sin(x)"]}']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`^${DEFAULT_BASE_URL.replace(/[./]/g, '\\$&')}#z=[\\w-]+$`));
      expect(await specOf(r.out)).toEqual({ expressions: ['y = sin(x)'] });
      expect(r.err).toMatch(/\[0\] y = sin\(x\)\s+→\s+function y\(x\)/);
    });

    it('reads a spec file or stdin', async () => {
      const spec = { expressions: [{ expr: "y' = -y", ic: 2 }] };
      const f = await run(['link', 'g.json'], { 'g.json': JSON.stringify(spec) });
      expect(f.code).toBe(0);
      expect(await specOf(f.out)).toEqual(spec);
      const s = await run(['link', '-', '--format', 'json'], {}, JSON.stringify(spec));
      expect(s.out).toMatch(/#spec=/);
      expect(await specOf(s.out)).toEqual(spec);
    });

    it('builds a spec from flags', async () => {
      const r = await run([
        'link',
        '--expr', "y'' = -y",
        '--ic', '1,0',
        '--color', 'red',
        '--expr', 'k = 2',
        '--min=0',
        '--max=5',
        '--expr', 'y = k',
        '--hidden',
        '--xmin', '-1',
        '--xmax', '2pi',
        '--format', 'params',
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('#expr=');
      expect(validateSpec(await specOf(r.out))).toEqual(
        validateSpec({
          expressions: [
            { expr: "y'' = -y", ic: [1, 0], color: 'red' },
            { expr: 'k = 2', min: 0, max: 5 },
            { expr: 'y = k', hidden: true },
          ],
          viewport: { xmin: -1, xmax: '2pi' },
        }),
      );
    });

    it('appends flag expressions to a spec', async () => {
      const r = await run(['link', '{"expressions":["k = 1"]}', '--expr', 'y = k*x', '--format', 'json']);
      expect(r.code).toBe(0);
      expect(await specOf(r.out)).toEqual({ expressions: ['k = 1', 'y = k*x'] });
    });

    it('honours --base', async () => {
      const r = await run(['link', '--expr', 'y=x', '--base', 'http://localhost:5173/', '--format', 'params']);
      expect(r.out).toBe('http://localhost:5173/#expr=y=x');
    });

    it('refuses to link a broken graph (exit 1), unless --force', async () => {
      const r = await run(['link', '--expr', 'y = a*x']);
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
      expect(r.err).toMatch(/undefined variable a/);
      expect(r.err).toMatch(/--force/);
      const f = await run(['link', '--expr', 'y = a*x', '--force']);
      expect(f.code).toBe(1);
      expect(f.out).toMatch(/#z=/);
    });

    it('reports structural errors with suggestions', async () => {
      const r = await run(['link', '{"expressions":["y=x"],"viewport":{"xMin":0}}']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/viewport\.xMin: unknown key "xMin" \(did you mean "xmin"\?\)/);
    });
  });

  describe('check', () => {
    it('prints a JSON report', async () => {
      const r = await run(['check', '--expr', "y'' = -y", '--expr', 'y = q']);
      expect(r.code).toBe(1);
      const rep = JSON.parse(r.out);
      expect(rep.ok).toBe(false);
      expect(rep.expressions.map((e: { kind: string }) => e.kind)).toEqual(['ode', 'function']);
      expect(rep.errors[0].path).toBe('expressions[1]');
      expect(rep).not.toHaveProperty('spec');
    });
    it('exits 0 for a good graph', async () => {
      const r = await run(['check', '["y = x^2", "x^2 + y^2 = 4"]']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out).ok).toBe(true);
    });
  });

  describe('decode', () => {
    it('round-trips with link', async () => {
      const spec = { expressions: ['y = sin(x)', { expr: 'k = 1', min: -2, max: 2 }] };
      const link = (await run(['link', JSON.stringify(spec)])).out;
      const d = await run(['decode', link]);
      expect(d.code).toBe(0);
      expect(JSON.parse(d.out)).toEqual(spec);
    });
    it('reports links without a graph', async () => {
      const d = await run(['decode', DEFAULT_BASE_URL]);
      expect(d.code).toBe(2);
      expect(d.err).toMatch(/No Fluxion graph/);
    });
    it('passes on params warnings', async () => {
      const d = await run(['decode', `${DEFAULT_BASE_URL}#expr=y=x&colr=red`]);
      expect(d.code).toBe(0);
      expect(d.err).toMatch(/did you mean "color"/);
    });
  });

  describe('usage errors (exit 2)', () => {
    const cases: [string[], RegExp][] = [
      [['frobnicate'], /unknown command "frobnicate"/],
      [['link'], /no graph given/],
      [['link', '--expr'], /--expr needs a value/],
      [['link', '--ic', '1'], /--ic must follow an --expr/],
      [['link', '--hidden'], /--hidden must follow an --expr/],
      [['link', '--expr', 'y=x', '--format', 'png'], /--format must be one of/],
      [['link', '--expr', 'y=x', '--colour', 'red'], /unknown option --colour/],
      [['link', '{not json'], /not valid JSON/],
      [['link', 'missing.json'], /ENOENT/],
      [['decode'], /decode needs a URL/],
    ];
    for (const [argv, re] of cases) {
      it(argv.join(' ') || '(none)', async () => {
        const r = await run(argv);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(re);
      });
    }
  });
});

describe('check runs a spec script against its own expressions', () => {
  it('graph.ode sees the ODE (used to get none: the normalised spec was re-validated)', async () => {
    const spec = {
      expressions: [{ expr: "theta'' = -g/L*sin(theta)", ic: [1, 0] }, 'g = 9.81', { expr: 'L = 3', min: 1, max: 5 }],
      script: 'const th = graph.ode("theta")\ncircle(0, th(time), 0.3)',
      viewport: { xmin: -5, xmax: 5 },
    };
    const r = await run(['check', 's.json'], { 's.json': JSON.stringify(spec) });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).errors).toEqual([]);
  }, 30000);
});
