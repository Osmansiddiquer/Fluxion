import { describe, expect, it } from 'vitest';
import { checkScript } from './scriptCheck';
import { runCli, type CliIO } from './fluxion';

function io(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = {
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    readStdin: async () => '',
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { cli, out, err };
}

describe('checkScript (node:vm, timeout)', () => {
  it('runs a script at several times and summarises what it drew', async () => {
    const r = await checkScript('circle(cos(time), 0, 1); point(0, 0); slider("k", 0, 1); print(time)', { times: [0, 1] });
    expect(r.ok).toBe(true);
    expect(r.frames).toHaveLength(2);
    expect(r.frames[0]).toMatchObject({ time: 0, shapes: 2, kinds: { path: 1, point: 1 }, sliders: ['k'], logs: ['0'], animated: true });
    expect(r.frames[1].logs).toEqual(['1']);
  }, 60_000);

  it('reports runtime errors with their line', async () => {
    const r = await checkScript('circle(0, 0, 1)\nif (time > 0.5) boom()', { times: [0, 1] });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([{ time: 1, message: expect.stringMatching(/boom/), line: 2 }]);
  });

  it('reports syntax errors once', async () => {
    const r = await checkScript('circle(0, 0', { times: [0, 1, 2] });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/SyntaxError/);
  });

  it('cuts off an endless loop', async () => {
    const t = Date.now();
    const r = await checkScript('while (true) {}', { timeoutMs: 300 });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.errors[0].message).toMatch(/endless loop/);
  });

  it('gives the script no Node globals and no way out of its realm', async () => {
    const r = await checkScript(
      [
        'const g = (0, eval)("this")',
        'print(typeof g.process, typeof g.require, typeof g.fetch, typeof g.Buffer)',
        // Climbing through any function's constructor stays inside the context.
        'print(circle.constructor("return typeof process")(), circle.constructor("return this")() === g)',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);
    expect(r.frames[0].logs).toEqual(['undefined undefined undefined undefined', 'undefined true']);
  });

  it('reads Graph-mode expressions', async () => {
    const r = await checkScript('print(graph.ode("y")(PI).toFixed(3), graph.value("k"))', {
      entries: [
        { raw: "y'' = -y", visible: true, ic: [1, 0] },
        { raw: 'k = 4', visible: true },
      ],
      times: [0],
    });
    expect(r.frames[0].logs).toEqual(['-1.000 4']);
  });
});

describe('fluxion CLI with scripts', () => {
  it('fluxion script FILE prints a report (exit 0 / 1)', async () => {
    const a = io({ 'ok.js': 'circle(0, 0, 1)', 'bad.js': 'nope()' });
    expect(await runCli(['script', 'ok.js', '--time', '0,2'], a.cli)).toBe(0);
    expect(JSON.parse(a.out[0]).frames.map((f: { time: number }) => f.time)).toEqual([0, 2]);
    const b = io({ 'bad.js': 'nope()' });
    expect(await runCli(['script', 'bad.js'], b.cli)).toBe(1);
    expect(JSON.parse(b.out[0]).errors[0]).toMatchObject({ line: 1 });
  });

  it('--spec supplies Graph-mode expressions', async () => {
    const a = io({ 'p.js': 'print(graph.value("k"))', 's.json': '{"expressions":["k = 3"]}' });
    expect(await runCli(['script', 'p.js', '--spec', 's.json', '--time', '0'], a.cli)).toBe(0);
    expect(JSON.parse(a.out[0]).frames[0].logs).toEqual(['3']);
  });

  it('check runs a spec script and fails on its errors', async () => {
    const good = io();
    expect(await runCli(['check', JSON.stringify({ script: 'circle(0, 0, 1)' })], good.cli)).toBe(0);
    expect(JSON.parse(good.out[0]).script.frames[0].shapes).toBe(1);
    const bad = io();
    expect(await runCli(['check', JSON.stringify({ expressions: ['k = 1'], script: 'circle(0, 0, k)' })], bad.cli)).toBe(1);
    expect(JSON.parse(bad.out[0]).errors[0]).toMatchObject({ path: 'script', message: expect.stringMatching(/line 1: .*k/) });
  });

  it('link refuses a broken script unless --force', async () => {
    const a = io();
    expect(await runCli(['link', JSON.stringify({ script: 'circle(' })], a.cli)).toBe(1);
    const b = io();
    expect(await runCli(['link', JSON.stringify({ script: 'circle(0, 0, 2)' })], b.cli)).toBe(0);
    expect(b.out[0]).toMatch(/#z=/);
  });
});
