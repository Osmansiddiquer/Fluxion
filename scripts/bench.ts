/**
 * Frame benchmark: how long one animation frame of an animator-style scene
 * takes in the compute + style pipeline (what runs on every slider tick).
 *
 *   npx vite-node scripts/bench.ts            # default 120 frames
 *   npx vite-node scripts/bench.ts -- 300     # more frames
 *
 * Each frame advances the clock T by 1/30 s, so every T-dependent curve misses
 * the result cache (as in real playback), then resolves every entry's style.
 */
import { computeAll } from '../src/lib/compute';
import { resolveStyle } from '../src/lib/style';
import { buildVarScope } from '../src/lib/math/resolveSlice';
import { BENCH_VIEWPORT, benchScene } from './bench-scene';
import { parseEntry } from '../src/lib/math/parse';
import { computeSignature } from '../src/state/signature';

const frames = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 120);
const SAMPLES = 2000; // ≈ a 1333-px-wide plot (sampleCount = 1.5 × window width)

function frame(T: number) {
  const entries = benchScene(T);
  computeSignature(entries);
  const results = computeAll(entries, BENCH_VIEWPORT, SAMPLES);
  const scope = buildVarScope(entries);
  for (const en of entries) resolveStyle(en, results.get(en.id), scope);
  return results;
}

const scene = benchScene(0);
for (const en of scene) parseEntry(en.raw);
// Warm up (JIT, parse + compile caches).
for (let i = 0; i < 10; i++) frame(i / 30);

const times: number[] = [];
let pts = 0;
for (let i = 0; i < frames; i++) {
  const t0 = performance.now();
  const res = frame(1 + i / 30);
  times.push(performance.now() - t0);
  if (i === 0) for (const r of res.values()) for (const s of r.curve.segments) pts += s.length;
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const med = times[Math.floor(times.length / 2)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(
  JSON.stringify({ expressions: scene.length, frames, sampledPoints: pts, meanMs: +mean.toFixed(2), medianMs: +med.toFixed(2), p95Ms: +p95.toFixed(2) }),
);
