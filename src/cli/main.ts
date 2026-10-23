// Entry point for `npm run fluxion -- …` (run through vite-node, which comes with
// Vitest, so the CLI uses the app's TypeScript sources directly).
import { readFile } from 'node:fs/promises';
import { runCli } from './fluxion';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const code = await runCli(process.argv.slice(2), {
  readFile: (p) => readFile(p, 'utf8'),
  readStdin,
  out: (t) => process.stdout.write(t + '\n'),
  err: (t) => process.stderr.write(t + '\n'),
});
process.exitCode = code;
